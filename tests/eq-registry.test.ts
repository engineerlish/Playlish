import { describe, expect, it } from 'vitest';
import { EqConfigLookup, type RegQuery } from '../src/main/eq/registry';

const FOUND = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\EqualizerAPO\r\n    ConfigPath    REG_SZ    C:\\Program Files\\EqualizerAPO\\config\r\n';

/** A reg query that answers when the test says so. */
function fakeQuery() {
  const pending: ((err: Error | null, stdout: string) => void)[] = [];
  const query: RegQuery = (callback) => pending.push(callback);
  return {
    query,
    reads: () => pending.length,
    answer: (stdout: string | null) => {
      const callback = pending.shift();
      if (!callback) throw new Error('No read is waiting');
      callback(stdout === null ? new Error('The system was unable to find the specified registry key') : null, stdout ?? '');
    },
  };
}

describe('EqConfigLookup', () => {
  it('never waits: the first question starts one read and answers null; the answer comes later', () => {
    const reg = fakeQuery();
    let changes = 0;
    const lookup = new EqConfigLookup(reg.query, () => changes++, 60_000, () => 0);

    expect(lookup.path()).toBeNull();
    expect(lookup.path()).toBeNull();
    expect(reg.reads()).toBe(1);

    reg.answer(FOUND);
    expect(changes).toBe(1);
    expect(lookup.path()).toBe('C:\\Program Files\\EqualizerAPO\\config');
    expect(reg.reads()).toBe(0);
  });

  it('a missing key means not installed', () => {
    const reg = fakeQuery();
    let changes = 0;
    const lookup = new EqConfigLookup(reg.query, () => changes++, 60_000, () => 0);
    lookup.path();
    reg.answer(null);

    expect(lookup.path()).toBeNull();
    // The first answer counts as a change even when it is "not installed", so the status is settled.
    expect(changes).toBe(1);
  });

  it('checks again in the background after the interval, and reports only a changed answer', () => {
    const reg = fakeQuery();
    let changes = 0;
    let now = 0;
    const lookup = new EqConfigLookup(reg.query, () => changes++, 60_000, () => now);
    lookup.path();
    reg.answer(null);

    now = 30_000;
    lookup.path();
    expect(reg.reads()).toBe(0);

    now = 61_000;
    expect(lookup.path()).toBeNull(); // the old answer, until the new one comes
    expect(reg.reads()).toBe(1);
    reg.answer(null);
    expect(changes).toBe(1);

    // Equalizer APO was installed meanwhile.
    now = 130_000;
    lookup.path();
    reg.answer(FOUND);
    expect(changes).toBe(2);
    expect(lookup.path()).toBe('C:\\Program Files\\EqualizerAPO\\config');
  });
});
