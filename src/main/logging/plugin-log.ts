import type { Logger, LogOptions } from './logger';

/** The logging interface handed to code that runs on behalf of one plugin. */
export interface PluginLogger {
  error(msg: string, options?: LogOptions): void;
  warn(msg: string, options?: LogOptions): void;
  info(msg: string, options?: LogOptions): void;
}

/**
 * Plugin problems are kept apart from the app's own log (their own file, via the logger passed in) and every entry
 * is tagged with the plugin id and version. Error counts per plugin are kept so a misbehaving plugin can be found and
 * disabled.
 */
export class PluginErrorLog {
  private readonly errors = new Map<string, number>();

  constructor(private readonly logger: Logger) {}

  /** A logger for one plugin version. */
  forPlugin(pluginId: string, pluginVersion: string): PluginLogger {
    const log = this.logger.child(`plugin:${pluginId}@${pluginVersion}`);
    const tag = (options: LogOptions = {}): LogOptions => ({
      ...options,
      context: { ...options.context, pluginId, pluginVersion },
    });
    return {
      error: (msg, options) => {
        this.errors.set(pluginId, (this.errors.get(pluginId) ?? 0) + 1);
        log.error(msg, tag(options));
      },
      warn: (msg, options) => log.warn(msg, tag(options)),
      info: (msg, options) => log.info(msg, tag(options)),
    };
  }

  /** How many errors a plugin has logged since start. */
  errorCount(pluginId: string): number {
    return this.errors.get(pluginId) ?? 0;
  }
}
