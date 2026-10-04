import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

/** Only these files are ever served, so the loopback server can't be used to read anything else on disk. */
const STATIC_FILES: Record<string, string> = {
  '/host.html': 'text/html; charset=utf-8',
  '/host.js': 'text/javascript; charset=utf-8',
  '/fade.js': 'text/javascript; charset=utf-8',
  '/stall.js': 'text/javascript; charset=utf-8',
  '/ui.html': 'text/html; charset=utf-8',
  '/ui.js': 'text/javascript; charset=utf-8',
  '/ui.css': 'text/css; charset=utf-8',
};

export interface ServerOptions {
  port: number;
  /** Directory containing the built renderer files. */
  webRoot: string;
  /** Handles the OAuth redirect; returns the HTML body shown in the browser tab. */
  onCallback: (params: URLSearchParams) => Promise<string>;
}

/** Escapes text for safe inclusion in the small HTML pages this server returns. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Minimal page shown in the browser tab after login finishes (or fails). */
export function resultPage(title: string, message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></body>`;
}

/**
 * Starts the loopback HTTP server (127.0.0.1 only). It serves the renderer pages, which gives the playback host a
 * secure-context origin for EME/Widevine, and receives the OAuth redirect. It is idle (no timers) unless a request arrives.
 */
export function startServer(options: ServerOptions): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${options.port}`);

    if (req.method === 'GET' && url.pathname === '/callback') {
      options
        .onCallback(url.searchParams)
        .then((html) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(html);
        })
        .catch((err: Error) => {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(resultPage('Login failed', err.message));
        });
      return;
    }

    const type = req.method === 'GET' ? STATIC_FILES[url.pathname] : undefined;
    if (!type) {
      res.writeHead(404).end();
      return;
    }
    fs.readFile(path.join(options.webRoot, url.pathname), (err, data) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolve(server));
  });
}
