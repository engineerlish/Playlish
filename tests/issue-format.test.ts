import { describe, expect, it } from 'vitest';
import { buildIssue, fingerprint, fingerprintMarker, occurrenceComment, type FailureReport } from '../tools/issues/format';

const BASE: FailureReport = {
  kind: 'smoke-failure',
  suite: 'smoke',
  name: 'Real audio is playing',
  error: 'No audio: peak 0.0000 after 15 s',
  location: 'step:real-audio',
  commit: 'abc1234',
  branch: 'main',
  environment: { OS: 'Windows 10.0.26200', App: '0.1.0', Electron: '44.1.0' },
  area: 'audio',
  severity: 'high',
  seenAt: '2026-10-03T12:00:00.000Z',
};

describe('fingerprint', () => {
  it('is stable for the same failure even when the message details change', () => {
    const a = fingerprint(BASE);
    const b = fingerprint({ ...BASE, error: 'No audio: peak 0.0012 after 20 s' });

    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a);
  });

  it('changes with the step, the location or the error type', () => {
    const a = fingerprint(BASE);

    expect(fingerprint({ ...BASE, name: 'Pause gives silence' })).not.toBe(a);
    expect(fingerprint({ ...BASE, location: 'step:pause' })).not.toBe(a);
    expect(fingerprint({ ...BASE, error: 'TypeError: x is undefined' })).not.toBe(a);
  });
});

describe('buildIssue', () => {
  it('uses the test-failure title format and labels', () => {
    const issue = buildIssue(BASE);

    expect(issue.title).toBe('[test-failure] smoke: Real audio is playing');
    expect(issue.labels).toEqual(['test-failure', 'area:audio', 'severity:high', 'needs-triage']);
  });

  it('uses the crash format for crashes', () => {
    const issue = buildIssue({ ...BASE, kind: 'crash', suite: 'player', name: 'renderer gone' });

    expect(issue.title).toBe('[crash] player: renderer gone');
    expect(issue.labels[0]).toBe('crash');
  });

  it('contains every section and the fingerprint marker', () => {
    const issue = buildIssue({ ...BASE, steps: ['Run npm run smoke'], logLines: ['line a', 'line b'], runLink: 'https://example.invalid/run/1', details: 'peak readings: 0, 0, 0' });

    for (const heading of ['**What failed**', '**Error**', '**Details**', '**Where**', '**Environment**', '**Steps to reproduce**', '**Last log lines**', '**Occurrences**']) {
      expect(issue.body).toContain(heading);
    }
    expect(issue.body).toContain(`<!-- ${fingerprintMarker(issue.fingerprint)} -->`);
    expect(issue.body).toContain('| OS | Windows 10.0.26200 |');
    expect(issue.body).toContain('1. Run npm run smoke');
  });

  it('keeps only the last 30 log lines', () => {
    const logLines = Array.from({ length: 50 }, (_, i) => `log ${i}`);

    const body = buildIssue({ ...BASE, logLines }).body;

    expect(body).toContain('log 49');
    expect(body).not.toContain('log 19\n');
  });

  it('redacts secrets anywhere in the issue', () => {
    const issue = buildIssue({
      ...BASE,
      name: 'Login for someone@example.com',
      error: 'token request failed for 0123456789abcdef0123456789abcdef',
      logLines: ['Authorization: Bearer abc.def.ghi'],
    });

    const all = `${issue.title}\n${issue.body}`;
    expect(all).not.toMatch(/someone@example\.com|0123456789abcdef0123456789abcdef|abc\.def\.ghi/);
  });
});

describe('occurrenceComment', () => {
  it('marks a regression when the issue had to be reopened', () => {
    expect(occurrenceComment(BASE, true)).toContain('**Regression:**');
    expect(occurrenceComment(BASE, false)).toContain('**Seen again.**');
    expect(occurrenceComment(BASE, false)).toContain('abc1234');
  });
});
