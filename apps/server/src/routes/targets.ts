import type { FastifyInstance } from 'fastify';
import { createTargetSchema, updateTargetSchema } from '@dashboard/shared';

import type { AppContext } from '../context.js';
import {
  checkTarget,
  createTarget,
  deleteTarget,
  getTarget,
  listTargets,
  updateTarget,
} from '../services/targets.js';

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
}
