import type { FastifyInstance } from 'fastify';
import { createTargetSchema, updateTargetSchema } from '@dashboard/shared';
import { z } from 'zod';

import type { AppContext } from '../context.js';
import {
  checkTarget,
  createTarget,
  deleteTarget,
  getTarget,
  listTargetDirectories,
  listTargets,
  updateTarget,
} from '../services/targets.js';

const directoryQuery = z.object({
  path: z.string().min(1).max(4096).default('/'),
});

export function registerTargetRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/targets', () => listTargets(ctx.db));

  app.post('/api/targets', (request, reply) => {
    const input = createTargetSchema.parse(request.body);
    return reply.code(201).send(createTarget(ctx.db, ctx.box, input));
  });

  app.get<{ Params: { id: string } }>('/api/targets/:id', (request) =>
    getTarget(ctx.db, request.params.id),
  );

  app.patch<{ Params: { id: string } }>('/api/targets/:id', (request) => {
    const input = updateTargetSchema.parse(request.body);
    return updateTarget(ctx.db, ctx.box, request.params.id, input);
  });

  app.delete<{ Params: { id: string } }>('/api/targets/:id', (request, reply) => {
    deleteTarget(ctx.db, request.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/targets/:id/check', (request) =>
    checkTarget(ctx.db, ctx.box, request.params.id, { stagingRoot: ctx.config.stagingDir }),
  );

  // Browsing needs the target itself: what exists is a fact only the host can answer.
  app.get<{ Params: { id: string } }>('/api/targets/:id/directories', (request) =>
    listTargetDirectories(ctx.db, ctx.box, request.params.id, directoryQuery.parse(request.query).path),
  );
}
