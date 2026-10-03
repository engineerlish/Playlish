/*
 * A very small Chrome DevTools Protocol client for the smoke test: find a page of the running app by URL and run a
 * line of JavaScript in it (for example, click a button). Uses Node's built-in WebSocket; no dependencies.
 */

interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

interface EvaluateReply {
  id: number;
  result?: { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
  error?: { message: string };
}

/** Lists the debuggable pages of the app on the given local port. */
export async function listPages(port: number): Promise<Target[]> {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  return ((await res.json()) as Target[]).filter((t) => t.type === 'page');
}

/** Evaluates an expression in the first page whose URL contains `urlPart` and returns its value. */
export async function evaluate(port: number, urlPart: string, expression: string): Promise<unknown> {
  const target = (await listPages(port)).find((t) => t.url.includes(urlPart));
  if (!target) throw new Error(`No page matching "${urlPart}" is open.`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not connect to the DevTools port.'));
    });
    const reply = await new Promise<EvaluateReply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DevTools did not answer within 5 seconds.')), 5000);
      ws.onmessage = (message: { data: unknown }) => {
        const parsed = JSON.parse(String(message.data)) as EvaluateReply;
        if (parsed.id !== 1) return;
        clearTimeout(timer);
        resolve(parsed);
      };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    if (reply.error) throw new Error(reply.error.message);
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text ?? 'Script error in the page.');
    return reply.result?.result?.value;
  } finally {
    ws.close();
  }
}

/** Clicks an element by id in the UI window. */
export function click(port: number, elementId: string): Promise<unknown> {
  return evaluate(port, '/ui.html', `document.getElementById(${JSON.stringify(elementId)}).click(); true`);
}

/** Sets a range input in the UI window and fires its input event, as if the user dragged it. */
export function setRange(port: number, elementId: string, value: number): Promise<unknown> {
  return evaluate(
    port,
    '/ui.html',
    `(() => { const el = document.getElementById(${JSON.stringify(elementId)}); el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('input')); return true; })()`,
  );
}
