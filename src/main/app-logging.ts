import { app } from 'electron';
import * as os from 'node:os';
import * as path from 'node:path';
import { CrashRecorder, type AppInfo } from './logging/crash';
import { ConsoleSink, Logger, RotatingFileSink, type LogLevel, type LogSink } from './logging/logger';
import { PluginErrorLog } from './logging/plugin-log';

/** Everything the app needs for diagnostics, created once at start-up. */
export interface AppLogging {
  /** Root logger; use `log.child('<module>')` per area. */
  log: Logger;
  crashes: CrashRecorder;
  plugins: PluginErrorLog;
  /** Folder with playlish.log, plugins.log and the crashes folder. */
  logsDir: string;
  /** The current app log file. */
  logFile: string;
}

/** Version and environment details used in crash reports and issue reports. */
export function appInfo(): AppInfo {
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
  };
}

/**
 * Creates the loggers under <userData>/logs. PLAYLISH_DEBUG=1 lowers the level to debug. Development builds also
 * print to the console. If the log folder cannot be created, logging falls back to the console instead of stopping
 * the app.
 */
export function initLogging(): AppLogging {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  const logFile = path.join(logsDir, 'playlish.log');
  const level: LogLevel = process.env['PLAYLISH_DEBUG'] === '1' ? 'debug' : 'info';

  const console = new ConsoleSink();
  /** A file sink, or the console if the file cannot be opened. */
  const fileOrConsole = (file: string): LogSink => {
    try {
      return new RotatingFileSink(file);
    } catch {
      return console;
    }
  };

  const appSink = fileOrConsole(logFile);
  const sinks = app.isPackaged || appSink === console ? [appSink] : [appSink, console];
  const log = Logger.create(sinks, level);
  const crashes = new CrashRecorder(path.join(logsDir, 'crashes'), appInfo(), log.child('crash'));
  const plugins = new PluginErrorLog(Logger.create([fileOrConsole(path.join(logsDir, 'plugins.log'))], level));
  return { log, crashes, plugins, logsDir, logFile };
}
