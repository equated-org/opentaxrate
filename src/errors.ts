/**
 * The one way a lookup says no: why, as a person reads it, a stable code for
 * a program, and the HTTP status that goes with it.
 *   - 422: the address can't be placed in one rate (the message names the
 *     candidates), or the state or date isn't covered;
 *   - 502 or 504: data isn't loaded, or an outside service failed.
 * RATE_LIMITED is the per-IP limiter's 429 (limits.ts) and INVALID_API_KEY
 * the 401 for a key the API doesn't know (access.ts), KEY_LIMITED and
 * NO_CREDITS an account key's 429 and 402, written by the HTTP
 * layer rather than thrown, listed here so clients see every code.
 */
export const RATE_ERROR_CODES = [
  "UNSUPPORTED_STATE",
  "ADDRESS_NEEDS_CONFIRMATION",
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_TIMEOUT",
  "RATE_LIMITED",
  "INVALID_API_KEY",
  "KEY_LIMITED",
  "NO_CREDITS",
] as const;

export type RateErrorCode = (typeof RATE_ERROR_CODES)[number];

export class RateError extends Error {
  constructor(
    message: string,
    readonly status: 422 | 502 | 504,
    readonly resultCode?: number,
    readonly code: RateErrorCode = status === 422
      ? "ADDRESS_NEEDS_CONFIRMATION"
      : status === 504
        ? "UPSTREAM_TIMEOUT"
        : "UPSTREAM_UNAVAILABLE",
  ) {
    super(message);
  }
}
