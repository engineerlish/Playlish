import type { FromHost, ToHost } from './protocol';
import { PluginSandbox, SandboxDisabledError, createEngine, type Engine, type SandboxHost, type SandboxLimits } from './sandbox';

/*
 * The plugin-host process (#100): an Electron utility process (Node only, no window) that holds every enabled plugin's
 * sandbox. It never talks to Spotify or the disk; a plugin's actions go to the main process as messages, which checks
 * permissions and runs them. If a plugin crashes this process, the main process restarts it without that plugin.
 *
 * The message handling is a plain function of a `send` callback, so tests run it without Electron.
 */

type Create = (code: string, host: SandboxHost, limits: SandboxLimits) => Promise<PluginSandbox>;

// CHANGE HERE: the hard memory ceiling of the engine all plugins share (see sandbox.ts).
export const SHARED_ENGINE_MB = 64;

/** One engine for every plugin in this process, created with the first plugin. */
function sharedEngineCreate(): Create {
  let engine: Promise<Engine> | null = null;
  return async (code, host, limits) => {
    engine ??= createEngine(SHARED_ENGINE_MB);
    return PluginSandbox.create(code, host, limits, undefined, await engine);
  };
}

/** Handles messages from the main process; returns the function to call with each message. */
export function createHostHandler(send: (message: FromHost) => void, create: Create = sharedEngineCreate()) {
  const sandboxes = new Map<string, PluginSandbox>();
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextCallId = 1;

  /** Reports a sandbox that disabled itself, and frees it. */
  const checkDisabled = (pluginId: string, sandbox: PluginSandbox) => {
    if (!sandbox.isDisabled()) return;
    send({ type: 'disabled', pluginId, reasons: sandbox.stats().violations });
    sandbox.dispose();
    sandboxes.delete(pluginId);
  };

  return async function onMessage(message: ToHost): Promise<void> {
    switch (message.type) {
      case 'load': {
        const { pluginId } = message;
        sandboxes.get(pluginId)?.dispose();
        sandboxes.delete(pluginId);
        try {
          const sandbox = await create(
            message.code,
            {
              call: (action, args) =>
                new Promise((resolve, reject) => {
                  const callId = nextCallId++;
                  pending.set(callId, { resolve, reject });
                  send({ type: 'call', callId, pluginId, action, args });
                }),
              log: (level, text) => send({ type: 'log', pluginId, level, message: text }),
            },
            message.limits,
          );
          sandboxes.set(pluginId, sandbox);
          send({ type: 'loaded', pluginId });
        } catch (err) {
          send({ type: 'load-failed', pluginId, error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      case 'unload':
        sandboxes.get(message.pluginId)?.dispose();
        sandboxes.delete(message.pluginId);
        return;
      case 'event':
        for (const pluginId of message.pluginIds) {
          const sandbox = sandboxes.get(pluginId);
          if (!sandbox) continue;
          try {
            sandbox.dispatch(message.event, message.payload);
          } catch (err) {
            if (!(err instanceof SandboxDisabledError)) send({ type: 'event-failed', pluginId, event: message.event, error: err instanceof Error ? err.message : String(err) });
          }
          checkDisabled(pluginId, sandbox);
        }
        return;
      case 'reply': {
        const waiting = pending.get(message.callId);
        if (!waiting) return;
        pending.delete(message.callId);
        if (message.ok) waiting.resolve(message.value);
        else waiting.reject(new Error(message.error ?? 'refused'));
        return;
      }
    }
  };
}

/** Wires the handler to Electron's parent port when this file runs as the utility process. */
interface ParentPort {
  on(event: 'message', listener: (e: { data: ToHost }) => void): void;
  postMessage(message: FromHost): void;
}
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (parentPort) {
  const handle = createHostHandler((m) => parentPort.postMessage(m));
  parentPort.on('message', (e) => void handle(e.data));
  parentPort.postMessage({ type: 'ready' });
}
