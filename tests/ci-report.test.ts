import { describe, expect, it } from 'vitest';
import { areaFor, playwrightFailures, vitestFailures, type RunContext } from '../tools/issues/ci-report';
import { buildIssue } from '../tools/issues/format';

const CTX: RunContext = { commit: 'abc1234', branch: 'main', runLink: 'https://github.com/o/r/actions/runs/1', environment: { Runner: 'Windows (X64)' }, seenAt: '2026-10-04T00:00:00.000Z' };

const VITEST = {
  testResults: [
    {
      // A Windows runner path, as Vitest reports it.
      name: ['D:', 'a', 'Playlish', 'Playlish', 'tests', 'now-playing.test.ts'].join(String.fromCharCode(92)),
      assertionResults: [
        { fullName: 'NowPlayingController polls', status: 'passed', failureMessages: [] },
        { fullName: 'NowPlayingController mutes', status: 'failed', failureMessages: ['\u001b[31mAssertionError: expected 0 to be 0.4\u001b[39m\n    at tests/now-playing.test.ts:10'] },
        { fullName: 'NowPlayingController retries', status: 'passed', failureMessages: ['Error: timed out'] },
      ],
    },
  ],
};

const PLAYWRIGHT = {
  suites: [
    {
      title: 'library.spec.ts',
      specs: [],
      suites: [
        {
          title: 'library',
          specs: [
            { title: 'pages load', file: 'library.spec.ts', line: 66, tests: [{ status: 'expected', results: [{ status: 'passed' }] }] },
            { title: 'plays a song', file: 'library.spec.ts', line: 79, tests: [{ status: 'unexpected', results: [{ status: 'failed', error: { message: 'Error: expect(locator).toHaveText', stack: 'at library.spec.ts:85' } }] }] },
            { title: 'remembers', file: 'library.spec.ts', line: 91, tests: [{ status: 'flaky', results: [{ status: 'failed', error: { message: 'TimeoutError: 30000ms' } }, { status: 'passed' }] }] },
          ],
        },
      ],
    },
  ],
};

describe('vitestFailures', () => {
  it('reports failed tests as high severity and tests that passed on the retry as flaky', () => {
    const reports = vitestFailures(VITEST, CTX);

    expect(reports.map((r) => [r.name, r.flaky, r.severity, r.location, r.area])).toEqual([
      ['NowPlayingController mutes', false, 'high', 'tests/now-playing.test.ts', 'player'],
      ['NowPlayingController retries', true, 'low', 'tests/now-playing.test.ts', 'player'],
    ]);
    expect(reports[0]?.error).toBe('AssertionError: expected 0 to be 0.4');
    expect(reports[0]?.runLink).toBe(CTX.runLink);
  });
});

describe('playwrightFailures', () => {
  it('reports unexpected and flaky end-to-end tests with their describe path and line', () => {
    const reports = playwrightFailures(PLAYWRIGHT, CTX);

    expect(reports.map((r) => [r.name, r.flaky, r.location, r.area])).toEqual([
      ['library › plays a song', false, 'tests/e2e/library.spec.ts:79', 'library'],
      ['library › remembers', true, 'tests/e2e/library.spec.ts:91', 'library'],
    ]);
    expect(reports[1]?.error).toBe('TimeoutError: 30000ms');
  });

  it('copes with empty or missing results', () => {
    expect(playwrightFailures({}, CTX)).toEqual([]);
    expect(vitestFailures({}, CTX)).toEqual([]);
  });
});

describe('areaFor and the issue format', () => {
  it.each([
    ['tests/auth.test.ts', 'auth'],
    ['tests/e2e/first-run.spec.ts', 'auth'],
    ['tests/e2e/search.spec.ts', 'library'],
    ['tests/spotify-client.integration.test.ts', 'api-client'],
    ['tests/e2e/plugins.spec.ts', 'plugins'],
    ['tests/fade.test.ts', 'audio'],
    ['tests/e2e/devices.spec.ts', 'player'],
    ['tests/window-state.test.ts', 'ui'],
  ])('%s -> %s', (file, area) => {
    expect(areaFor(file)).toBe(area);
  });

  it('files a flaky test with the flaky-test title and label', () => {
    const [, flaky] = vitestFailures(VITEST, CTX);
    const draft = buildIssue(flaky as NonNullable<typeof flaky>);

    expect(draft.title).toBe('[flaky-test] unit: NowPlayingController retries');
    expect(draft.labels).toEqual(['flaky-test', 'area:player', 'severity:low', 'needs-triage']);
    expect(draft.body).toContain('it failed, then passed on the retry');
  });
});
