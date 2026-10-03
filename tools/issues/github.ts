/*
 * Files or updates GitHub issues for failures through the GitHub CLI, using the login of whoever runs it.
 * One issue per fingerprint: an open match gets a comment, a closed match is reopened and labelled regression.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fingerprintMarker, occurrenceComment, type FailureReport, type IssueDraft } from './format.ts';

export interface FiledIssue {
  action: 'created' | 'commented' | 'reopened';
  number: number;
}

/** Runs gh with a body passed through a temporary file (no shell quoting problems), returning stdout. */
function gh(args: string[], body?: string): string {
  let bodyFile: string | null = null;
  try {
    if (body !== undefined) {
      bodyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-gh-')), 'body.md');
      fs.writeFileSync(bodyFile, body);
      args = [...args, '--body-file', bodyFile];
    }
    return execFileSync('gh', args, { encoding: 'utf8' });
  } finally {
    if (bodyFile) fs.rmSync(path.dirname(bodyFile), { recursive: true, force: true });
  }
}

/** Finds an issue (open or closed) that carries the fingerprint marker. */
export function findByFingerprint(repo: string, fingerprint: string): { number: number; state: string } | null {
  const out = gh(['issue', 'list', '--repo', repo, '--state', 'all', '--search', `"${fingerprintMarker(fingerprint)}" in:body`, '--json', 'number,state', '--limit', '5']);
  const found = JSON.parse(out) as { number: number; state: string }[];
  return found[0] ?? null;
}

/** Creates the issue, or comments on (and if needed reopens) the existing one with the same fingerprint. */
export function fileFailure(repo: string, report: FailureReport, draft: IssueDraft): FiledIssue {
  const existing = findByFingerprint(repo, draft.fingerprint);
  if (existing && existing.state === 'OPEN') {
    gh(['issue', 'comment', String(existing.number), '--repo', repo], occurrenceComment(report, false));
    return { action: 'commented', number: existing.number };
  }
  if (existing) {
    gh(['issue', 'reopen', String(existing.number), '--repo', repo]);
    gh(['issue', 'edit', String(existing.number), '--repo', repo, '--add-label', 'regression']);
    gh(['issue', 'comment', String(existing.number), '--repo', repo], occurrenceComment(report, true));
    return { action: 'reopened', number: existing.number };
  }
  const url = gh(['issue', 'create', '--repo', repo, '--title', draft.title, '--label', draft.labels.join(',')], draft.body).trim();
  return { action: 'created', number: Number(url.split('/').pop()) };
}
