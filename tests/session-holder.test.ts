import { describe, expect, it } from 'vitest';
import { SessionHolder } from '../src/main/session-holder';

const A = '0123456789abcdef0123456789abcdef';
const B = 'fedcba9876543210fedcba9876543210';

/** A holder whose logins are plain objects, recording what happened. */
function holder() {
  const created: string[] = [];
  let forgotten = 0;
  const h = new SessionHolder({
    create: (clientId) => {
      created.push(clientId);
      return { clientId };
    },
    forgetStoredSession: () => {
      forgotten++;
    },
  });
  return { h, created, forgotten: () => forgotten };
}

describe('SessionHolder', () => {
  it('keeps the stored session when the first login is created at start-up (regression: login lost on every restart)', () => {
    const { h, forgotten } = holder();

    h.use(A);

    expect(forgotten()).toBe(0);
  });

  it('returns the same login for the same Client ID and does not forget anything', () => {
    const { h, created, forgotten } = holder();

    const first = h.use(A);
    const second = h.use(A);

    expect(second).toBe(first);
    expect(created).toEqual([A]);
    expect(forgotten()).toBe(0);
  });

  it('creates a new login and forgets the old stored session when the Client ID changes', () => {
    const { h, created, forgotten } = holder();
    h.use(A);

    const next = h.use(B);

    expect(next).toEqual({ clientId: B });
    expect(created).toEqual([A, B]);
    expect(forgotten()).toBe(1);
    expect(h.clientId).toBe(B);
  });

  it('has no login before the first one', () => {
    const { h } = holder();

    expect(h.session).toBeNull();
    expect(h.clientId).toBeNull();
  });
});
