import type { FastifyInstance } from 'fastify';
import { saveScriptScheduleSchema } from '@dashboard/shared';
import { z } from 'zod';
import type { AppContext } from '../context.js';

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function registerScriptScheduleRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/script-schedules', () => ctx.scriptSchedules.list());

  app.post('/api/script-schedules', (request, reply) => {
    // Persisted work must not be enabled while the process is already stopping its scheduler.
    if (ctx.isShuttingDown()) {
      return reply.code(503).send({ error: { code: 'shutting_down', message: 'The server is shutting down' } });
    }
    return reply.code(201).send(ctx.scriptSchedules.create(saveScriptScheduleSchema.parse(request.body)));
  });

  app.get<{ Params: { id: string } }>('/api/script-schedules/:id', (request) =>
    ctx.scriptSchedules.get(request.params.id),
  );

  app.put<{ Params: { id: string } }>('/api/script-schedules/:id', (request, reply) => {
    if (ctx.isShuttingDown()) {
      return reply.code(503).send({ error: { code: 'shutting_down', message: 'The server is shutting down' } });
    }
    return ctx.scriptSchedules.save(request.params.id, saveScriptScheduleSchema.parse(request.body));
  });

  app.delete<{ Params: { id: string } }>('/api/script-schedules/:id', (request, reply) => {
    ctx.scriptSchedules.remove(request.params.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>('/api/script-schedules/:id/executions', (request) => {
    ctx.scriptSchedules.get(request.params.id);
    return ctx.executions.list({ scheduleId: request.params.id, ...historyQuery.parse(request.query) });
  });
}
