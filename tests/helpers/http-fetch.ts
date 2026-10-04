import * as http from 'node:http';

/*
 * A small fetch for the unit and integration tests, built on node:http instead of Node's built-in fetch (undici).
 *
 * Why: on Windows, Node 24 test workers that had used the built-in fetch crashed now and then while exiting
 * (exit code 0xC0000409, the libuv assertion "!(handle->flags & UV_HANDLE_CLOSING)" in src\win\async.c). The crash
 * killed the worker before its results were reported: about one run in three of the full suite. Every test only
 * talks to servers on 127.0.0.1, so this covers what they need: method, headers, string bodies, status and body.
 * No redirects, no compression, no abort signals.
 */
export async function httpFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.protocol !== 'http:') throw new TypeError(`test fetch only supports http, not ${url.protocol}`);
  const headers: Record<string, string> = { connection: 'close' };
  new Headers(init.headers).forEach((value, key) => {
    headers[key] = value;
  });
  const raw = init.body;
  // The code under test only sends strings (JSON) and URLSearchParams (token requests).
  if (raw !== undefined && raw !== null && typeof raw !== 'string' && !(raw instanceof URLSearchParams)) throw new TypeError('test fetch only sends string or URLSearchParams bodies');
  const body = raw === undefined || raw === null ? undefined : raw.toString();
  if (raw instanceof URLSearchParams && !headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
  if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));

  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: init.method ?? 'GET', headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', (err) => reject(new TypeError('fetch failed', { cause: err })));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) value.forEach((v) => responseHeaders.append(key, v));
          else if (value !== undefined) responseHeaders.set(key, value);
        }
        // Responses with these statuses must not have a body.
        const empty = status === 204 || status === 205 || status === 304;
        resolve(new Response(empty ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage ?? '', headers: responseHeaders }));
      });
    });
    // Like the built-in fetch: network failures reject with a TypeError.
    request.on('error', (err) => reject(new TypeError('fetch failed', { cause: err })));
    if (body !== undefined) request.write(body);
    request.end();
  });
}
