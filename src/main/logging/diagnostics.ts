import type { AppInfo, CrashReport } from './crash';
import { redactText } from './redact';

/*
 * "Export diagnostics" and "Report an issue". Pure functions: the caller reads the files and opens the browser.
 * Everything that leaves the app is redacted again here, even though the logger already redacted it, in case a file
 * was written by an older version or by something other than the logger.
 */

// CHANGE HERE: where reports go. Only this exact URL is ever opened.
export const NEW_ISSUE_URL = 'https://github.com/engineerlish/Playlish/issues/new';
// CHANGE HERE: browsers and GitHub handle URLs up to about 8 KB; stay well under it.
export const MAX_ISSUE_URL_LENGTH = 7500;
// CHANGE HERE: how much of each log goes into an exported bundle.
export const BUNDLE_LOG_LINES = 400;

export interface DiagnosticsInput {
  generatedAt: Date;
  app: AppInfo;
  /** Short facts about the current state (status line, whether configured, logged in...). No secrets. */
  state: Record<string, string | number | boolean | null>;
  /** Contents of playlish.log and its rotated copies, newest file first. */
  appLogs: string[];
  /** Contents of plugins.log, newest first. */
  pluginLogs: string[];
  /** Newest crash reports first, already parsed. */
  crashes: CrashReport[];
}

/** The last `count` non-empty lines across the given files (newest file first). */
export function lastLines(filesNewestFirst: string[], count: number): string[] {
  const lines: string[] = [];
  for (const text of filesNewestFirst) {
    const fileLines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    lines.unshift(...fileLines.slice(Math.max(0, fileLines.length - (count - lines.length))));
    if (lines.length >= count) break;
  }
  return lines.slice(-count);
}

/** Builds the single text file written by "Export diagnostics". */
export function buildDiagnosticsBundle(input: DiagnosticsInput): string {
  const section = (title: string, body: string) => `===== ${title} =====\n${body.trim() === '' ? '(empty)' : body.trim()}\n`;
  const parts = [
    'Playlish diagnostics. Secrets and personal data are removed; please still read it before sharing.',
    '',
    section('Generated', input.generatedAt.toISOString()),
    section('App', JSON.stringify(input.app, null, 2)),
    section('State', JSON.stringify(input.state, null, 2)),
    section(`App log (last ${BUNDLE_LOG_LINES} lines)`, lastLines(input.appLogs, BUNDLE_LOG_LINES).join('\n')),
    section(`Plugin log (last ${BUNDLE_LOG_LINES} lines)`, lastLines(input.pluginLogs, BUNDLE_LOG_LINES).join('\n')),
    section(`Crash reports (${input.crashes.length}, newest first)`, input.crashes.map((c) => JSON.stringify(c, null, 2)).join('\n\n')),
  ];
  return redactText(parts.join('\n'));
}

export interface IssueInput {
  kind: 'bug' | 'crash';
  title: string;
  /** What happened, as known to the app (for a crash: kind and process). */
  summary: string;
  app: AppInfo;
  /** Recent log lines or the crash report, oldest first; trimmed from the start to fit. */
  details: string[];
}

/**
 * Builds a pre-filled GitHub "new issue" URL using the repository's issue forms. The user reviews and submits it in
 * their browser; nothing is sent by the app. Fields are matched by the form field ids in .github/ISSUE_TEMPLATE.
 */
export function buildIssueUrl(input: IssueInput): string {
  const template = input.kind === 'crash' ? 'crash_report.yml' : 'bug_report.yml';
  const detailsField = input.kind === 'crash' ? 'crash-report' : 'logs';
  const base: Record<string, string> = {
    template,
    title: redactText(input.title).slice(0, 200),
    'what-happened': redactText(input.summary).slice(0, 1000),
    version: input.app.appVersion,
    ...(input.kind === 'bug' ? { os: `Windows ${input.app.osRelease} (${input.app.arch})` } : {}),
  };

  const urlFor = (detailLines: string[]) => {
    const params = new URLSearchParams(base);
    const details = redactText(detailLines.join('\n'));
    if (details) params.set(detailsField, details);
    return `${NEW_ISSUE_URL}?${params.toString()}`;
  };

  // Keep the most recent details: drop lines from the start until the URL fits.
  let lines = [...input.details];
  let url = urlFor(lines);
  while (url.length > MAX_ISSUE_URL_LENGTH && lines.length > 0) {
    const drop = Math.max(1, Math.ceil(lines.length / 10));
    lines = lines.slice(drop);
    url = urlFor(lines.length > 0 ? ['(older lines removed to fit)', ...lines] : []);
  }
  return url;
}

/** Short identity of a crash report, used to remember which ones the user has already been asked about. */
export function crashId(report: Pick<CrashReport, 'ts' | 'process'>): string {
  return `${report.ts}|${report.process}`;
}

/** The newest crash report the user has not been asked about yet, or null. */
export function unseenCrash(newestFirst: CrashReport[], seenIds: ReadonlySet<string>): CrashReport | null {
  const newest = newestFirst[0];
  return newest && !seenIds.has(crashId(newest)) ? newest : null;
}

/** The issue for a crash report, for "Report it" after a crash. */
export function crashIssue(report: CrashReport, app: AppInfo): IssueInput {
  const message = typeof report.error === 'object' && report.error !== null && 'message' in report.error ? String((report.error).message) : '';
  return {
    kind: 'crash',
    title: `[crash] ${report.process}: ${report.kind}${message ? ` - ${message.slice(0, 80)}` : ''}`,
    summary: `Playlish recorded a ${report.kind} in the ${report.process} process at ${report.ts}.`,
    app,
    details: JSON.stringify(report, null, 2).split('\n'),
  };
}
