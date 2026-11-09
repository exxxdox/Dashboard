import type { FastifyInstance } from 'fastify';
import { saveScriptScheduleSchema } from '@dashboard/shared';
import type { AppContext } from '../context.js';

export function registerScriptScheduleRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Params: { id: string } }>('/api/scripts/:id/schedule', (request) =>
    ctx.scriptSchedules.get(request.params.id),
  );

  app.put<{ Params: { id: string } }>('/api/scripts/:id/schedule', (request, reply) => {
    // Persisted work must not be enabled while the process is already stopping its scheduler.
    if (ctx.isShuttingDown()) {
      return reply.code(503).send({ error: { code: 'shutting_down', message: 'The server is shutting down' } });
    }
    return ctx.scriptSchedules.save(request.params.id, saveScriptScheduleSchema.parse(request.body));
  });

  app.delete<{ Params: { id: string } }>('/api/scripts/:id/schedule', (request, reply) => {
    ctx.scriptSchedules.remove(request.params.id);
    return reply.code(204).send();
  });
}
