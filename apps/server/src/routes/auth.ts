/**
 * Sign in, sign out, and "am I signed in?".
 *
 * The last of those answers even when nobody is signed in -- 200 with
 * `signedIn: false` -- because the client has to know *whether the server wants
 * a login at all* before it can decide what to render, and a 401 there would be
 * indistinguishable from an expired session.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loginSchema, type AuthStatus } from '@script-dashboard/shared';

import type { AppContext } from '../context.js';
import {
  clearSessionCookie,
  readCookie,
  serializeSessionCookie,
  SESSION_COOKIE,
  type Authenticator,
} from '../lib/auth.js';
import { RateLimitedError, UnauthorizedError } from '../lib/errors.js';

/** True when the request carries a session this server signed. */
export function isSignedIn(auth: Authenticator, request: FastifyRequest): boolean {
  return auth.verify(readCookie(request.headers.cookie, SESSION_COOKIE), Date.now()) !== null;
}

/**
 * Secure only when the request actually arrived over https.
 *
 * A browser drops a Secure cookie delivered over plain http without a word, so
 * guessing wrong here means sign-in silently never works. A proxy in front is
 * the usual reason a request is https while this process speaks http.
 */
export function isSecureRequest(request: FastifyRequest): boolean {
  const forwarded = request.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return request.protocol === 'https' || proto === 'https';
}

export function setSessionCookie(reply: FastifyReply, auth: Authenticator, secure: boolean): void {
  const session = auth.issue(Date.now());
  reply.header(
    'set-cookie',
    serializeSessionCookie(session.value, { maxAgeSec: session.maxAgeSec, secure }),
  );
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { auth, loginThrottle, logger } = ctx;

  app.get('/api/auth/me', (request): AuthStatus => {
    if (!auth.enabled) return { required: false, signedIn: true };
    return { required: true, signedIn: isSignedIn(auth, request) };
  });

  app.post('/api/auth/login', (request, reply): AuthStatus => {
    if (!auth.enabled) return { required: false, signedIn: true };

    const address = request.ip;
    if (loginThrottle.isLocked(address, Date.now())) {
      // 429 rather than 401: this caller is not necessarily wrong, they are
      // being told to stop guessing for a while.
      void reply.header('retry-after', '900');
      throw new RateLimitedError();
    }

    const input = loginSchema.parse(request.body);
    if (!auth.checkCredentials(input.username, input.password)) {
      loginThrottle.recordFailure(address, Date.now());
      logger.warn({ address }, 'failed sign-in attempt');
      throw new UnauthorizedError('That username and password do not match');
    }

    loginThrottle.reset(address);
    setSessionCookie(reply, auth, isSecureRequest(request));
    logger.info({ address, username: input.username }, 'signed in');
    return { required: true, signedIn: true };
  });

  app.post('/api/auth/logout', (_request, reply): AuthStatus => {
    // No session required to sign out: clearing a cookie that is not there is
    // not an error worth reporting, and the client wants the same answer either
    // way.
    reply.header('set-cookie', clearSessionCookie());
    return { required: auth.enabled, signedIn: !auth.enabled };
  });
}
