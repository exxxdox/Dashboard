/**
 * Fastify assembly: plugins, routes, the error contract, and static hosting.
 *
 * The error handler here is the only place that turns a thrown value into a
 * response, so every failure the client sees has the same shape.
 */

import { existsSync } from 'node:fs';

import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import type { AppContext } from './context.js';
import { SCHEMA_VERSION } from './db/schema.js';
import { AppError } from './lib/errors.js';
import { isSecureRequest, registerAuthRoutes, setSessionCookie } from './routes/auth.js';
import { readCookie, SESSION_COOKIE } from './lib/auth.js';
import { registerExecutionRoutes } from './routes/executions.js';
import { registerSourceRoutes } from './routes/sources.js';
import { registerTargetRoutes } from './routes/targets.js';

/**
 * Paths that answer without a session.
 *
 * `/api/health` stays open so an uptime check keeps working, and it reveals
 * nothing but a version. The auth routes have to be reachable or nobody could
 * ever sign in. Everything else under `/api` -- including the WebSocket, whose
 * handshake carries the same cookie -- needs a session. Static files are open by
 * design: the app shell is what renders the login form, and the bundle holds no
 * data.
 */
const PUBLIC_API_PATHS = new Set(['/api/health', '/api/auth/me', '/api/auth/login', '/api/auth/logout']);

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Require a session for the API, and refuse cross-site writes while we are here.
 *
 * The cookie is already `SameSite=Strict`, which is what actually stops a
 * cross-site request from carrying it; this checks the second signal so a
 * browser that ignores that attribute -- or a future change to it -- does not
 * quietly become a CSRF hole.
 */
function installAuthGuard(app: FastifyInstance, ctx: AppContext): void {
  app.addHook('onRequest', (request, reply, done) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api') || PUBLIC_API_PATHS.has(path)) {
      done();
      return;
    }

    const site = request.headers['sec-fetch-site'];
    if (STATE_CHANGING_METHODS.has(request.method) && typeof site === 'string' && site !== 'same-origin') {
      void reply.code(403).send({
        error: { code: 'cross_site', message: 'Cross-site requests are not accepted' },
      });
      return;
    }

    const session = ctx.auth.verify(
      readCookie(request.headers.cookie, SESSION_COOKIE),
      Date.now(),
    );
    if (!session) {
      void reply.code(401).send({
        error: { code: 'unauthorized', message: 'Sign in to continue' },
      });
      return;
    }

    // Sliding expiry: a session in daily use has its cookie pushed back out
    // rather than expiring mid-week.
    if (ctx.auth.shouldRenew(session.issuedAt, Date.now())) {
      setSessionCookie(reply, ctx.auth, isSecureRequest(request));
    }
    done();
  });
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  // Widen to Fastify's own logger interface before handing it over. Passing the
  // concrete pino type makes Fastify *infer* an instance parameterised by pino's
  // Logger, which then no longer matches the plain `FastifyInstance` every route
  // module is written against. pino satisfies FastifyBaseLogger structurally.
  const logger: FastifyBaseLogger = ctx.logger;

  const app = Fastify({
    // Reuse the application logger instead of letting Fastify build its own, so
    // every line lands in one stream with one level setting.
    loggerInstance: logger,
    // Script sources can be large, but a request body never legitimately is.
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(fastifyWebsocket);

  // Sign-in routes first: the hook below must not stand in front of the login
  // that satisfies it.
  registerAuthRoutes(app, ctx);

  if (ctx.auth.enabled) installAuthGuard(app, ctx);

  app.get('/api/health', () => ({
    status: 'ok' as const,
    version: process.env.npm_package_version ?? '0.1.0',
    // The database's migration version, not an API contract version: hardcoded
    // to 1, this reported the same number across every schema change and so
    // could not answer "did this database migrate?".
    schemaVersion: SCHEMA_VERSION,
  }));

  registerTargetRoutes(app, ctx);
  registerSourceRoutes(app, ctx);
  registerExecutionRoutes(app, ctx);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Request validation failures are the user's input, not a server fault.
    if (error instanceof ZodError) {
      return reply.code(422).send({
        error: {
          code: 'validation_failed',
          message: 'The request did not match the expected shape',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    // Fastify's own errors (body too large, unsupported media type) carry a
    // status; anything else is genuinely unexpected and must not leak internals.
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled request error');
      return reply.code(500).send({
        error: { code: 'internal_error', message: 'An unexpected error occurred' },
      });
    }

    return reply.code(status).send({
      error: { code: 'request_error', message: error.message },
    });
  });

  const webRoot = ctx.config.webDistDir;
  if (ctx.config.serveWeb && existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, prefix: '/' });

    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split('?')[0] ?? '';

      // Unknown API paths must stay JSON.
      if (path.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
      }

      // A request for something that looks like a file gets a 404, not the SPA
      // shell. The common case is a stale hashed asset after a redeploy: handing
      // back HTML makes the browser refuse it with a MIME-type error that hides
      // the real cause.
      const lastSegment = path.slice(path.lastIndexOf('/') + 1);
      if (lastSegment.includes('.')) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
      }

      // Everything else is a client-side route; hand over the shell.
      return reply.sendFile('index.html');
    });
  } else if (ctx.config.serveWeb) {
    ctx.logger.warn(
      { webRoot },
      'web assets not found; serving the API only. Build the web app or set WEB_DIST_DIR.',
    );
  }

  return app;
}
