/**
 * Error types that carry an HTTP status.
 *
 * Route handlers throw these; the error hook in `app.ts` is the single place
 * that turns them into responses, so no handler has to build an error body.
 *
 * Every error may also carry an `ErrorI18n`: a locale-neutral identity for its
 * message. The server cannot render a sentence for a reader whose language it
 * does not know, so `message` stays English -- it is what the log records and
 * what the client shows when it has no wording of its own -- while `i18n` lets
 * a client that does have one use it. An error without a key is not a gap to
 * paper over: it is a message the client was never meant to translate.
 */

import type { ErrorI18n } from '@dashboard/shared';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  /** Extra fields merged into the response body, e.g. per-field validation errors. */
  readonly details: unknown;
  /** How to say this in the reader's own language, when there is a way. */
  readonly i18n: ErrorI18n | null;

  constructor(
    message: string,
    statusCode = 400,
    code = 'bad_request',
    details?: unknown,
    i18n?: ErrorI18n,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.i18n = i18n ?? null;
  }
}

/**
 * `what` is the entity's name as it appears in a sentence -- "Target not
 * found". It doubles as the key's parameter, lowercased, so a call site does
 * not have to state the same fact twice.
 *
 * A caller whose `what` is a whole sentence rather than an entity name gets a
 * client that cannot translate it, which is the correct outcome: there is no
 * key for it, so the client shows the server's own words.
 */
export class NotFoundError extends AppError {
  constructor(what: string) {
    super(`${what} not found`, 404, 'not_found', undefined, {
      key: 'error.notFound',
      params: { entity: what.toLowerCase() },
    });
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, i18n?: ErrorI18n) {
    super(message, 409, 'conflict', undefined, i18n);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown, i18n?: ErrorI18n) {
    super(message, 422, 'validation_failed', details, i18n);
    this.name = 'ValidationError';
  }
}

/** No session, or credentials that do not match. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in to continue', i18n?: ErrorI18n) {
    super(message, 401, 'unauthorized', undefined, i18n);
    this.name = 'UnauthorizedError';
  }
}

/** Too many failed attempts from one address, for now. */
export class RateLimitedError extends AppError {
  constructor(message = 'Too many attempts. Try again later.', i18n?: ErrorI18n) {
    super(message, 429, 'rate_limited', undefined, i18n);
    this.name = 'RateLimitedError';
  }
}

/** A failure while talking to the target host (SSH, git, filesystem). */
export class TargetError extends AppError {
  constructor(message: string, details?: unknown, i18n?: ErrorI18n) {
    super(message, 502, 'target_error', details, i18n);
    this.name = 'TargetError';
  }
}

/**
 * A failure while talking to an external service: a DNS provider, the IPv6
 * probe, or the notifier.
 *
 * Distinct from `TargetError` (a host this application manages) because the two
 * want different words in the log and different things from the operator: a
 * target problem is usually the target's, an upstream problem usually is not.
 */
export class UpstreamError extends AppError {
  constructor(message: string, details?: unknown, i18n?: ErrorI18n) {
    super(message, 502, 'upstream_error', details, i18n);
    this.name = 'UpstreamError';
  }
}

/** The request was understood but the current state forbids it. */
export class UnprocessableError extends AppError {
  constructor(message: string, details?: unknown, i18n?: ErrorI18n) {
    super(message, 409, 'not_executable', details, i18n);
    this.name = 'UnprocessableError';
  }
}

/** True when the value is an `Error` with a message worth showing a user. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}
