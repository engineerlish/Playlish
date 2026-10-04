import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

/** One request received by the fake server, kept so tests can assert on exactly what the client sent. */
export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  /** Parsed JSON body, the raw string for non-JSON bodies, or undefined when there was no body. */
  body: unknown;
}

/** A canned response. Objects are sent as JSON; strings are sent as-is (use this for malformed bodies). */
export interface FakeResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  /** Wait this long before answering (use with fake timers or small values). */
  delayMs?: number;
  /** Destroy the socket instead of answering, to simulate network loss. */
  dropConnection?: boolean;
}

/** A canned response, or a function that builds one from the request (for answers that echo the request, like logins). */
export type FakeHandler = FakeResponse | ((request: RecordedRequest) => FakeResponse);

/**
 * A tiny local stand-in for Spotify's Web API and accounts service. Tests script it per route, point the code under
 * test at `baseUrl`, and then inspect `requests`. It never talks to the real Spotify, and it binds to 127.0.0.1 only.
 *
 * Responses for a route are served in order; the last one repeats, so `on('PUT', '/v1/me/player', r404, r404, r204)`
 * means "two 404s, then 204 from then on". Unscripted routes answer 404 with a Spotify-shaped error body.
 */
export class FakeSpotify {
  readonly requests: RecordedRequest[] = [];
  private readonly routes = new Map<string, FakeHandler[]>();
  private readonly server: http.Server;

  private constructor() {
    this.server = http.createServer((req, res) => void this.handle(req, res));
  }

  /** Starts a fake server on a random free port. */
  static async start(): Promise<FakeSpotify> {
    const fake = new FakeSpotify();
    await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
    return fake;
  }

  /** Base URL such as http://127.0.0.1:54321 (no trailing slash). */
  get baseUrl(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** Scripts the responses for a method and path (path without the query string). */
  on(method: string, path: string, ...responses: FakeHandler[]): this {
    if (responses.length === 0) throw new Error('on() needs at least one response');
    this.routes.set(`${method.toUpperCase()} ${path}`, [...responses]);
    return this;
  }

  /** Requests received for a method and path, in order. */
  requestsFor(method: string, path: string): RecordedRequest[] {
    return this.requests.filter((r) => r.method === method.toUpperCase() && r.path === path);
  }

  /** Stops the server and drops open connections. */
  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Records the request and answers from the script. */
  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.baseUrl);
    const method = (req.method ?? 'GET').toUpperCase();
    const recorded: RecordedRequest = {
      method,
      path: url.pathname,
      query: url.searchParams,
      headers: req.headers,
      body: await readBody(req),
    };
    this.requests.push(recorded);

    const scripted = this.routes.get(`${method} ${url.pathname}`);
    const handler: FakeHandler = scripted
      ? (scripted.length > 1 ? scripted.shift() : scripted[0]) ?? { status: 500 }
      : { status: 404, body: { error: { status: 404, message: 'Not found (unscripted route)' } } };
    const response = typeof handler === 'function' ? handler(recorded) : handler;

    if (response.dropConnection) {
      req.socket.destroy();
      return;
    }
    if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, response.delayMs));

    const isText = typeof response.body === 'string';
    const payload = response.body === undefined ? '' : isText ? (response.body as string) : JSON.stringify(response.body);
    res.writeHead(response.status, {
      ...(response.body !== undefined && !isText ? { 'Content-Type': 'application/json' } : {}),
      ...response.headers,
    });
    res.end(payload);
  }
}

/** Reads and parses a request body (JSON, form data kept as a string, or undefined when empty). */
async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
