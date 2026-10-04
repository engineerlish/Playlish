import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resultPage, startServer } from '../src/main/server';

let webRoot: string;
let outsideFile: string;
let server: http.Server | null = null;
let callbacks: URLSearchParams[];
let callbackHandler: (params: URLSearchParams) => Promise<string>;

/** Starts the server on a free port with the temp web root. */
async function start(): Promise<number> {
  server = await startServer({ port: 0, webRoot, onCallback: (p) => callbackHandler(p) });
  return (server.address() as AddressInfo).port;
}

/** Sends a request with a path exactly as written (fetch would normalize "../" before it reaches the server). */
function raw(port: number, method: string, rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: rawPath }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeEach(() => {
  webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-web-'));
  outsideFile = `${webRoot}-outside.txt`;
  fs.writeFileSync(path.join(webRoot, 'host.html'), '<h1>host</h1>');
  fs.writeFileSync(path.join(webRoot, 'host.js'), 'console.log("host")');
  fs.writeFileSync(path.join(webRoot, 'ui.html'), '<h1>ui</h1>');
  fs.writeFileSync(path.join(webRoot, 'secret.txt'), 'do not serve');
  fs.writeFileSync(outsideFile, 'outside the web root');
  callbacks = [];
  callbackHandler = (params) => {
    callbacks.push(params);
    return Promise.resolve('<p>ok</p>');
  };
});

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
  fs.rmSync(webRoot, { recursive: true, force: true });
  fs.rmSync(outsideFile, { force: true });
});

describe('static files', () => {
  it('serves the allowlisted files with the right content type and no caching', async () => {
    const port = await start();

    const html = await fetch(`http://127.0.0.1:${port}/host.html`);
    const js = await fetch(`http://127.0.0.1:${port}/host.js`);

    expect(html.status).toBe(200);
    expect(await html.text()).toBe('<h1>host</h1>');
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(html.headers.get('cache-control')).toBe('no-store');
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  });

  it('serves every module the playback host imports (read from host.ts, so a new import cannot be forgotten)', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'host.ts'), 'utf8');
    const modules = [...source.matchAll(/^import (?!type)[^;]*from '\.\/([\w-]+\.js)';/gm)].map((m) => m[1] ?? '');
    expect(modules).toEqual(expect.arrayContaining(['fade.js', 'stall.js', 'media-session.js']));
    for (const name of modules) fs.writeFileSync(path.join(webRoot, name), '// module');
    const port = await start();

    for (const name of modules) expect((await fetch(`http://127.0.0.1:${port}/${name}`)).status, name).toBe(200);
  });

  it('does not serve files that exist in the web root but are not on the allowlist', async () => {
    const port = await start();

    expect((await fetch(`http://127.0.0.1:${port}/secret.txt`)).status).toBe(404);
  });

  it('answers 404 for an allowlisted file that is missing on disk', async () => {
    fs.rmSync(path.join(webRoot, 'ui.html'));
    const port = await start();

    expect((await fetch(`http://127.0.0.1:${port}/ui.html`)).status).toBe(404);
  });

  it.each([
    ['dot segments', '/../playlish-outside.txt'],
    ['many dot segments', '/../../../../../../windows/win.ini'],
    ['encoded dot segments', '/%2e%2e/%2e%2e/windows/win.ini'],
    ['encoded slashes', '/..%2f..%2fsecret.txt'],
    ['backslashes', '/..\\..\\windows\\win.ini'],
    ['an allowlisted name followed by traversal', '/host.html/../../secret.txt'],
    ['a null byte', '/host.html%00.txt'],
  ])('rejects path traversal using %s', async (_name, rawPath) => {
    const port = await start();

    const res = await raw(port, 'GET', rawPath);

    expect(res.status).toBe(404);
    expect(res.body).not.toMatch(/do not serve|outside the web root|for 16-bit/);
  });

  it('only answers GET', async () => {
    const port = await start();

    expect((await raw(port, 'POST', '/host.html')).status).toBe(404);
    expect((await raw(port, 'DELETE', '/host.html')).status).toBe(404);
  });

  it('answers 404 for the root and unknown paths', async () => {
    const port = await start();

    expect((await raw(port, 'GET', '/')).status).toBe(404);
    expect((await raw(port, 'GET', '/nothing')).status).toBe(404);
  });
});

describe('OAuth callback', () => {
  it('passes the query string to the handler and returns its page', async () => {
    const port = await start();

    const res = await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=xyz`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<p>ok</p>');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(callbacks[0]?.get('code')).toBe('abc');
    expect(callbacks[0]?.get('state')).toBe('xyz');
  });

  it('shows a 400 page when the handler fails', async () => {
    callbackHandler = () => Promise.reject(new Error('Login was cancelled.'));
    const port = await start();

    const res = await fetch(`http://127.0.0.1:${port}/callback?error=access_denied`);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Login was cancelled.');
  });

  it('escapes HTML in error messages so a crafted callback cannot inject markup', async () => {
    callbackHandler = () => Promise.reject(new Error('<script>alert(1)</script>'));
    const port = await start();

    const body = await (await fetch(`http://127.0.0.1:${port}/callback?error=x`)).text();

    expect(body).not.toContain('<script>');
    expect(body).toContain('&#60;script&#62;');
  });

  it('only accepts GET on the callback', async () => {
    const port = await start();

    expect((await raw(port, 'POST', '/callback?code=a')).status).toBe(404);
    expect(callbacks).toHaveLength(0);
  });
});

describe('server lifecycle', () => {
  it('listens on the loopback interface only', async () => {
    await start();

    expect((server?.address() as AddressInfo).address).toBe('127.0.0.1');
  });

  it('fails to start when the port is already in use', async () => {
    const port = await start();

    await expect(startServer({ port, webRoot, onCallback: () => Promise.resolve('') })).rejects.toThrow(/EADDRINUSE/);
  });
});

describe('resultPage', () => {
  it('escapes the title and the message', () => {
    const page = resultPage('<b>Title</b>', 'a & b "quoted" <i>');

    expect(page).not.toContain('<b>Title</b>');
    expect(page).toContain('&#60;b&#62;Title&#60;/b&#62;');
    expect(page).toContain('a &#38; b &#34;quoted&#34; &#60;i&#62;');
  });
});
