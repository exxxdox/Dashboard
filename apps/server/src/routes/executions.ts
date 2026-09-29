// Side-effect import: @fastify/websocket augments Fastify's route options with
// the `websocket` flag through declaration merging, and that augmentation only
// applies in files that import the package.
import '@fastify/websocket';

import type { FastifyInstance } from 'fastify';
import {
  clientMessageSchema,
  executeScriptSchema,
  executionStatusSchema,
  type ServerMessage,
} from '@dashboard/shared';
import { z } from 'zod';

import type { AppContext } from '../context.js';
import { NotFoundError } from '../lib/errors.js';

const listQuery = z.object({
  scriptId: z.string().optional(),
  targetId: z.string().optional(),
  status: executionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const logsQuery = z.object({
  afterSeq: z.coerce.number().int().min(0).default(0),
});

/**
 * The slice of the WebSocket API this route uses.
 *
 * Declared structurally so the server does not take a direct dependency on `ws`
 * merely for its types; `@fastify/websocket` owns that package.
 */
type SocketLike = {
  send(data: string): void;
  close(): void;
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
};

export function registerExecutionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post<{ Params: { id: string } }>('/api/scripts/:id/execute', async (request, reply) => {
    if (ctx.isShuttingDown()) {
      return reply
        .code(503)
        .send({ error: { code: 'shutting_down', message: 'The server is shutting down' } });
    }

    const input = executeScriptSchema.parse(request.body);
    const execution = await ctx.executions.submit(request.params.id, input);
    return reply.code(202).send({ executionId: execution.id, status: execution.status });
  });

  app.get('/api/executions', (request) => ctx.executions.list(listQuery.parse(request.query)));

  app.get<{ Params: { id: string } }>('/api/executions/:id', (request) =>
    ctx.executions.get(request.params.id),
  );

  app.get<{ Params: { id: string } }>('/api/executions/:id/logs', (request) => {
    const query = logsQuery.parse(request.query);
    // Confirm the execution exists first, so a mistyped id returns 404 rather
    // than an empty log that looks like a run which produced no output.
    ctx.executions.get(request.params.id);
    return ctx.executions.logs(request.params.id, query.afterSeq);
  });

  app.post<{ Params: { id: string } }>('/api/executions/:id/cancel', (request) =>
    ctx.executions.cancel(request.params.id),
  );

  app.delete<{ Params: { id: string } }>('/api/executions/:id', (request, reply) => {
    ctx.executions.remove(request.params.id);
    return reply.code(204).send();
  });

  app.get('/api/ws', { websocket: true }, (socket, request) => {
    const connection = socket as unknown as SocketLike;
    const subscriptions = new Map<string, () => void>();

    const send = (message: ServerMessage): void => {
      try {
        connection.send(JSON.stringify(message));
      } catch {
        // The socket closed between the event and this write; the close handler
        // performs the cleanup.
      }
    };

    const unsubscribeAll = (): void => {
      for (const dispose of subscriptions.values()) dispose();
      subscriptions.clear();
    };

    send({ type: 'hello', serverTime: new Date().toISOString() });

    connection.on('message', (raw: unknown) => {
      let parsed;
      try {
        const text =
          typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
        parsed = clientMessageSchema.safeParse(JSON.parse(text));
      } catch {
        send({ type: 'error', message: 'Malformed message' });
        return;
      }

      if (!parsed.success) {
        send({ type: 'error', message: 'Unrecognised message' });
        return;
      }

      const message = parsed.data;

      if (message.type === 'ping') {
        send({ type: 'pong' });
        return;
      }

      if (message.type === 'unsubscribe') {
        subscriptions.get(message.executionId)?.();
        subscriptions.delete(message.executionId);
        return;
      }

      if (subscriptions.has(message.executionId)) {
        send({ type: 'subscribed', executionId: message.executionId });
        return;
      }

      // Subscribing to an unknown id is a client bug. Say so, rather than
      // leaving the caller waiting for events that will never arrive.
      try {
        ctx.executions.get(message.executionId);
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof NotFoundError ? 'No such execution' : 'Cannot subscribe',
        });
        return;
      }

      subscriptions.set(
        message.executionId,
        ctx.hub.subscribe(message.executionId, (event) => send(event)),
      );
      send({ type: 'subscribed', executionId: message.executionId });
    });

    connection.on('close', () => {
      unsubscribeAll();
      ctx.logger.debug({ url: request.url }, 'websocket closed');
    });

    connection.on('error', (error: Error) => {
      ctx.logger.debug({ err: error }, 'websocket error');
      unsubscribeAll();
    });
  });
}
