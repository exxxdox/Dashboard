/**
 * The DNS console's HTTP surface.
 *
 * Conventions are the rest of the server's: zod at the top of the handler, a
 * bare payload on success, and errors thrown as `AppError` so `app.ts` stays the
 * only place that builds an error body.
 *
 * Two deliberate differences from the Python API this replaces:
 *
 * - `limit`/`offset` out of range are a 422, not a silent clamp. The Python
 *   clamped `page` so a new row could not push the reader onto an empty page,
 *   which is a real concern; the answer here is that the client owns its paging
 *   and the boundary refuses nonsense instead of guessing.
 * - `POST /api/dns/update` answers 200 even when the run failed, with the reason
 *   in the body. A failed check is a result, not a transport error -- the same
 *   shape `TargetCheckResult.reachable: false` already uses.
 */

import type { FastifyInstance } from 'fastify';
import { testDnsNotificationSchema, updateDnsSettingsSchema } from '@dashboard/shared';
import { z } from 'zod';

import type { AppContext } from '../context.js';
import { toUpstreamError } from '../services/dns/service.js';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function registerDnsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { dns } = ctx;

  app.get('/api/dns', () => dns.state());

  app.patch('/api/dns/settings', (request) =>
    dns.saveSettings(updateDnsSettingsSchema.parse(request.body)),
  );

  app.post('/api/dns/ipv6', async () => {
    try {
      return await dns.detect();
    } catch (error) {
      // The probe has no history row to carry the reason, so it travels in the
      // error instead.
      throw toUpstreamError(error);
    }
  });

  app.post('/api/dns/record', async () => {
    try {
      return await dns.queryRecord();
    } catch (error) {
      throw toUpstreamError(error);
    }
  });

  app.post('/api/dns/update', async (_request, reply) => {
    if (ctx.isShuttingDown()) {
      // Refused rather than started: a run begun now would be cut off by the
      // shutdown already under way.
      return reply
        .code(503)
        .send({ error: { code: 'shutting_down', message: 'The server is shutting down' } });
    }
    return dns.update('manual');
  });

  app.post('/api/dns/notification-test', async (request) => {
    const input = testDnsNotificationSchema.parse(request.body);
    try {
      return await dns.testNotification(input);
    } catch (error) {
      throw toUpstreamError(error);
    }
  });

  app.get('/api/dns/checks', (request) => dns.listChecks(listQuery.parse(request.query)));

  app.delete('/api/dns/checks', (_request, reply) => {
    dns.clearChecks();
    return reply.code(204).send();
  });
}
