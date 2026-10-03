/*
 * Holds the login for the current Client ID. Asking for the same Client ID again returns the same login; asking for a
 * different one (the user changed it in the wizard) creates a new login and forgets the stored session of the old one.
 * Starting the first login never touches the stored session: that session is what lets Playlish stay logged in across
 * restarts.
 */

export interface SessionHolderDeps<A> {
  /** Creates the login (and anything tied to it) for a Client ID. */
  create(clientId: string): A;
  /** Deletes the stored session (the encrypted refresh token). */
  forgetStoredSession(): void;
}

export class SessionHolder<A> {
  private current: { clientId: string; session: A } | null = null;

  constructor(private readonly deps: SessionHolderDeps<A>) {}

  /** The login for this Client ID, creating it if needed. */
  use(clientId: string): A {
    if (this.current && this.current.clientId === clientId) return this.current.session;
    if (this.current) this.deps.forgetStoredSession();
    const session = this.deps.create(clientId);
    this.current = { clientId, session };
    return session;
  }

  /** The current login, or null before the first one. */
  get session(): A | null {
    return this.current?.session ?? null;
  }

  /** The Client ID of the current login, or null. */
  get clientId(): string | null {
    return this.current?.clientId ?? null;
  }
}
