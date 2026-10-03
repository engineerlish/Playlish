import { describe, expect, it } from 'vitest';
import type { AppInfo, CrashReport } from '../src/main/logging/crash';
import {
  MAX_ISSUE_URL_LENGTH,
  NEW_ISSUE_URL,
  buildDiagnosticsBundle,
  buildIssueUrl,
  crashId,
  crashIssue,
  lastLines,
  unseenCrash,
} from '../src/main/logging/diagnostics';

const APP: AppInfo = { appVersion: '0.1.0', electron: '44.1.0', chrome: '152', platform: 'win32', arch: 'x64', osRelease: '10.0.26200' };
const CLIENT_ID = '0123456789abcdef0123456789abcdef';

/** A crash report with the given time and process. */
function crash(ts: string, process = 'main', message = 'boom'): CrashReport {
  return { ts, kind: 'uncaughtException', process, error: { name: 'Error', message }, app: APP };
}

describe('lastLines', () => {
  it('takes the last lines across files, newest file first, in time order', () => {
    const newest = 'c1\nc2\n';
    const older = 'b1\nb2\nb3\n';
    const oldest = 'a1\n';

    expect(lastLines([newest, older, oldest], 4)).toEqual(['b2', 'b3', 'c1', 'c2']);
    expect(lastLines([newest, older, oldest], 100)).toEqual(['a1', 'b1', 'b2', 'b3', 'c1', 'c2']);
  });

  it('skips blank lines and handles Windows line endings', () => {
    expect(lastLines(['x\r\n\r\ny\r\n'], 5)).toEqual(['x', 'y']);
  });
});

describe('buildDiagnosticsBundle', () => {
  const input = {
    generatedAt: new Date('2026-10-03T12:00:00.000Z'),
    app: APP,
    state: { status: 'Playing.', loggedIn: true },
    appLogs: ['{"level":"info","msg":"Playing."}\n'],
    pluginLogs: [],
    crashes: [crash('2026-10-03T11:00:00.000Z')],
  };

  it('contains every section', () => {
    const bundle = buildDiagnosticsBundle(input);

    for (const title of ['Generated', 'App', 'State', 'App log', 'Plugin log', 'Crash reports (1, newest first)']) {
      expect(bundle).toContain(`===== ${title}`);
    }
    expect(bundle).toContain('"appVersion": "0.1.0"');
    expect(bundle).toContain('Playing.');
    expect(bundle).toContain('(empty)'); // the plugin log
  });

  it('redacts everything again, even text the logger never saw', () => {
    const bundle = buildDiagnosticsBundle({
      ...input,
      state: { note: `client ${CLIENT_ID} for someone@example.com` },
      appLogs: ['legacy line with Bearer abcdef123456 and ?code=XYZ'],
    });

    expect(bundle).not.toMatch(new RegExp(`${CLIENT_ID}|someone@example\\.com|abcdef123456|code=XYZ`));
  });
});

describe('buildIssueUrl', () => {
  it('opens the bug form with the fields filled in', () => {
    const url = new URL(buildIssueUrl({ kind: 'bug', title: 'Player stopped', summary: 'Silence after skip', app: APP, details: ['line 1', 'line 2'] }));

    expect(`${url.origin}${url.pathname}`).toBe(NEW_ISSUE_URL);
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('title')).toBe('Player stopped');
    expect(url.searchParams.get('what-happened')).toBe('Silence after skip');
    expect(url.searchParams.get('version')).toBe('0.1.0');
    expect(url.searchParams.get('os')).toBe('Windows 10.0.26200 (x64)');
    expect(url.searchParams.get('logs')).toBe('line 1\nline 2');
  });

  it('uses the crash form and its crash-report field for crashes', () => {
    const url = new URL(buildIssueUrl({ kind: 'crash', title: 't', summary: 's', app: APP, details: ['{}'] }));

    expect(url.searchParams.get('template')).toBe('crash_report.yml');
    expect(url.searchParams.get('crash-report')).toBe('{}');
    expect(url.searchParams.has('logs')).toBe(false);
  });

  it('redacts the title, summary and details', () => {
    const url = buildIssueUrl({
      kind: 'bug',
      title: `failed for ${CLIENT_ID}`,
      summary: 'me@example.com saw it',
      app: APP,
      details: ['Authorization: Bearer secrettoken'],
    });

    expect(decodeURIComponent(url)).not.toMatch(new RegExp(`${CLIENT_ID}|me@example\\.com|secrettoken`));
  });

  it('stays under the URL limit by dropping the oldest lines and keeps the newest', () => {
    const details = Array.from({ length: 2000 }, (_, i) => `log line ${i} ${'x'.repeat(30)}`);

    const url = buildIssueUrl({ kind: 'bug', title: 't', summary: 's', app: APP, details });

    expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
    const logs = new URL(url).searchParams.get('logs') ?? '';
    expect(logs).toContain('log line 1999');
    expect(logs).not.toContain('log line 0 ');
    expect(logs.startsWith('(older lines removed to fit)')).toBe(true);
  });

  it('only ever points at the project issue page', () => {
    const url = buildIssueUrl({ kind: 'bug', title: 'https://evil.example/', summary: 's', app: APP, details: [] });

    expect(url.startsWith(`${NEW_ISSUE_URL}?`)).toBe(true);
  });
});

describe('crash notices', () => {
  it('finds the newest crash that has not been offered yet', () => {
    const reports = [crash('2026-10-03T12:00:00.000Z', 'host'), crash('2026-10-03T11:00:00.000Z')];

    expect(unseenCrash(reports, new Set())).toBe(reports[0]);
    expect(unseenCrash(reports, new Set([crashId(reports[0] as CrashReport)]))).toBeNull();
    expect(unseenCrash([], new Set())).toBeNull();
  });

  it('builds a crash issue with a useful title and the report as details', () => {
    const issue = crashIssue(crash('2026-10-03T12:00:00.000Z', 'host', 'render failed'), APP);

    expect(issue.kind).toBe('crash');
    expect(issue.title).toBe('[crash] host: uncaughtException - render failed');
    expect(issue.summary).toContain('host process');
    expect(issue.details.join('\n')).toContain('"process": "host"');
  });
});
