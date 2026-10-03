/*
 * One issue format for every automated failure report: the local smoke test now, CI test failures later (#14).
 * Titles, bodies, labels and a fingerprint for deduplication. Everything is redacted before it is used.
 */
import { createHash } from 'node:crypto';
import { redactText } from '../../src/main/logging/redact.ts';

export type FailureKind = 'test-failure' | 'smoke-failure' | 'crash';

export interface FailureReport {
  kind: FailureKind;
  /** Suite or area, for example "smoke" or "plugins". */
  suite: string;
  /** Test or step name. */
  name: string;
  /** What went wrong, one line. */
  error: string;
  /** Where it happened (file:line for tests, step name for the smoke test); part of the fingerprint. */
  location: string;
  details?: string;
  steps?: string[];
  logLines?: string[];
  commit: string;
  branch: string;
  runLink?: string;
  environment: Record<string, string>;
  area: 'auth' | 'player' | 'library' | 'audio' | 'plugins' | 'ui' | 'api-client';
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** When the failure was seen (ISO). */
  seenAt: string;
}

export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
  fingerprint: string;
}

/** The first word-like token of an error, used as its type (for example TypeError or "No"). */
function errorType(error: string): string {
  return /^[A-Za-z_$][\w$]*/.exec(error.trim())?.[0] ?? 'Error';
}

/** Stable id for "the same failure": kind, suite, name, error type and location. Not the full message (it may vary). */
export function fingerprint(report: Pick<FailureReport, 'kind' | 'suite' | 'name' | 'error' | 'location'>): string {
  const key = [report.kind, report.suite, report.name, errorType(report.error), report.location].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** The marker that ties an issue to a fingerprint; searchable on GitHub. */
export function fingerprintMarker(id: string): string {
  return `playlish-fingerprint:${id}`;
}

/** Builds the issue title, body and labels for a failure. */
export function buildIssue(report: FailureReport): IssueDraft {
  const id = fingerprint(report);
  const prefix = report.kind === 'crash' ? '[crash]' : '[test-failure]';
  const title = redactText(`${prefix} ${report.suite}: ${report.name}`).slice(0, 200);
  const env = Object.entries(report.environment)
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join('\n');
  const sections = [
    `**What failed**\n${report.kind === 'smoke-failure' ? 'Local smoke test step' : 'Test'} \`${report.name}\` in \`${report.suite}\`.`,
    `**Error**\n\`\`\`\n${report.error}\n\`\`\``,
    ...(report.details ? [`**Details**\n\`\`\`\n${report.details}\n\`\`\``] : []),
    `**Where**\nCommit \`${report.commit}\` on \`${report.branch}\`${report.runLink ? ` · [run](${report.runLink})` : ''} · location \`${report.location}\``,
    `**Environment**\n| | |\n|---|---|\n${env}`,
    ...(report.steps?.length ? [`**Steps to reproduce**\n${report.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`] : []),
    ...(report.logLines?.length ? [`**Last log lines**\n\`\`\`\n${report.logLines.slice(-30).join('\n')}\n\`\`\``] : []),
    `**Occurrences**\nFirst seen ${report.seenAt} · last seen ${report.seenAt} · count 1`,
    `<!-- ${fingerprintMarker(id)} -->`,
  ];
  const labels = [
    report.kind === 'crash' ? 'crash' : 'test-failure',
    `area:${report.area}`,
    `severity:${report.severity}`,
    'needs-triage',
  ];
  return { title, body: redactText(sections.join('\n\n')), labels, fingerprint: id };
}

/** The comment added to an existing issue when the same failure happens again. */
export function occurrenceComment(report: FailureReport, reopened: boolean): string {
  const lines = [
    reopened ? '**Regression:** this failure is back after the issue was closed.' : '**Seen again.**',
    `Commit \`${report.commit}\` on \`${report.branch}\` at ${report.seenAt}${report.runLink ? ` · [run](${report.runLink})` : ''}.`,
    `\`\`\`\n${report.error}\n\`\`\``,
  ];
  return redactText(lines.join('\n\n'));
}
