/**
 * Error types that carry an HTTP status.
 *
 * Route handlers throw these; the error hook in `app.ts` is the single place
 * that turns them into responses, so no handler has to build an error body.
 */

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  /** Extra fields merged into the response body, e.g. per-field validation errors. */
  readonly details: unknown;

  constructor(message: string, statusCode = 400, code = 'bad_request', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super(`${what} not found`, 404, 'not_found');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'conflict');
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'validation_failed', details);
    this.name = 'ValidationError';
  }
}

/** No session, or credentials that do not match. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in to continue') {
    super(message, 401, 'unauthorized');
    this.name = 'UnauthorizedError';
  }
}

/** Too many failed attempts from one address, for now. */
export class RateLimitedError extends AppError {
  constructor(message = 'Too many attempts. Try again later.') {
    super(message, 429, 'rate_limited');
    this.name = 'RateLimitedError';
  }
}

/** A failure while talking to the target host (SSH, git, filesystem). */
export class TargetError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 502, 'target_error', details);
    this.name = 'TargetError';
  }
}

/** The request was understood but the current state forbids it. */
export class UnprocessableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'not_executable', details);
    this.name = 'UnprocessableError';
  }
}

/** True when the value is an `Error` with a message worth showing a user. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}
