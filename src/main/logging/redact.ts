/*
 * Removes secrets and personal data from anything before it is logged, written to a crash report, or put into an
 * issue report. Runs at the logger level, so a careless log call cannot leak a token.
 *
 * Deliberately conservative: it is better to redact a harmless value than to leak a token. Ordinary numbers such as
 * "status code: 403" are left alone so logs stay useful.
 */

export const REDACTED = '[REDACTED]';

// CHANGE HERE: field names whose values are always secret, in JSON ("key": "value") and in query/form strings (key=value).
const SECRET_FIELDS = [
  'access_token',
  'refresh_token',
  'id_token',
  'token',
  'code',
  'code_verifier',
  'code_challenge',
  'client_secret',
  'client_id',
  'password',
  'state',
];

// CHANGE HERE: object keys (in log context) whose values are always secret, matched case-insensitively.
const SECRET_KEY_PATTERN = /token|secret|password|verifier|authorization|cookie|email|client_?id|^code$|^state$/i;

const fieldList = SECRET_FIELDS.join('|');

/** Each rule is applied in order to every string. */
const RULES: [RegExp, string][] = [
  // Authorization headers.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`],
  // JSON string values of secret fields: "access_token": "..."
  [new RegExp(`(["'](?:${fieldList})["']\\s*:\\s*["'])[^"']*`, 'gi'), `$1${REDACTED}`],
  // Query and form values of secret fields: ?code=...&state=...
  [new RegExp(`([?&\\s]|^)((?:${fieldList})=)[^&\\s"'#]*`, 'gi'), `$1$2${REDACTED}`],
  // Email addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  // Spotify Client IDs: exactly 32 hex characters (40-character track and device ids are not touched).
  [/\b[0-9a-fA-F]{32}\b/g, '[CLIENT_ID]'],
  // Long opaque tokens (access tokens are 100+ characters of base64url).
  [/[A-Za-z0-9_-]{80,}/g, '[TOKEN]'],
  // The Windows (or macOS/Linux) user name in paths.
  [/([A-Za-z]:\\{1,2}Users\\{1,2})[^\\/:*?"<>|\s]+/gi, '$1[USER]'],
  [/(\/(?:Users|home)\/)[^/\s]+/g, '$1[USER]'],
];

/** Redacts secrets and personal data in a string. */
export function redactText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Redacts a value of any shape for logging: strings are cleaned, objects and arrays are copied with secret keys
 * blanked and every string cleaned, Errors become plain objects (name, message, stack). Cycles and very deep values
 * are cut off instead of crashing.
 */
export function redactValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' ? `[${typeof value}]` : value;
  }
  if (seen.has(value)) return '[Circular]';
  if (depth >= 6) return '[Too deep]';
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      ...(value.stack ? { stack: redactText(value.stack) } : {}),
    };
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(item, depth + 1, seen);
  }
  return out;
}
