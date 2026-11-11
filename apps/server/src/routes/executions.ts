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
  scheduleId: z.string().optional(),
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
  bufferedAmount?: number;
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
};

export function registerExecutionRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Leases belong to socket connections, while the runner owns the remote process.
  const controllers = new Map<string, SocketLike>();
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

  app.get('/api/ws', {
    websocket: true,
    preValidation: async (request, reply) => {
      const origin = request.headers.origin;
      const site = request.headers['sec-fetch-site'];
      let sameOrigin = origin === undefined;
      if (origin) {
        try {
          const parsed = new URL(origin);
          // Host is the browser-facing authority even behind a TLS reverse proxy;
          // forwarded headers are not trusted to grant another host access.
          sameOrigin = ['http:', 'https:'].includes(parsed.protocol) && parsed.host === request.headers.host
            && (request.protocol !== 'https' || parsed.protocol === 'https:');
        } catch { sameOrigin = false; }
      }
      if (!sameOrigin || (typeof site === 'string' && site !== 'same-origin' && site !== 'none')) {
        return reply.code(403).send({ error: { code: 'cross_site', message: 'Cross-site requests are not accepted' } });
      }
    },
  }, (socket, request) => {
    const connection = socket as unknown as SocketLike;
    const subscriptions = new Map<string, () => void>();
    let lastMessageAt = Date.now();
    let closed = false;
    const heartbeat = setInterval(() => {
      if (Date.now() - lastMessageAt > 60_000) {
        unsubscribeAll();
        connection.close();
      }
    }, 20_000);
    heartbeat.unref();

    const send = (message: ServerMessage): void => {
      try {
        if ((connection.bufferedAmount ?? 0) > 1024 * 1024) {
          unsubscribeAll();
          connection.close();
          return;
        }
        connection.send(JSON.stringify(message));
      } catch {
        // The socket closed between the event and this write; the close handler
        // performs the cleanup.
      }
    };

    const terminalState = (executionId: string, error?: string): void => {
      const current = ctx.executions.get(executionId);
      const terminal = (current.status === 'running' || current.status === 'queued') && current.interactive
        ? ctx.executions.terminal(executionId) : null;
      const owner = controllers.get(executionId);
      const state = current.status !== 'running' && current.status !== 'queued' ? 'closed'
        : !terminal ? 'waiting' : owner === connection ? 'controlling' : owner ? 'busy' : 'available';
      send({ type: 'terminal_state', executionId, state, ...(error ? { error } : {}) });
    };
    const release = (executionId: string): void => {
      if (controllers.get(executionId) !== connection) return;
      controllers.delete(executionId);
      ctx.hub.publish(executionId, { type: 'terminal_state', executionId, state: 'available' });
    };
    const unsubscribeAll = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      for (const [id, dispose] of subscriptions) {
        // Stop listening before releasing, so a closing socket cannot reclaim its lease.
        dispose();
        release(id);
      }
      subscriptions.clear();
    };

    send({ type: 'hello', serverTime: new Date().toISOString() });

    connection.on('message', (raw: unknown) => {
      if (closed) return;
      lastMessageAt = Date.now();
      let parsed;
      try {
        const text =
          typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
        if (Buffer.byteLength(text, 'utf8') > 65536) { send({ type: 'error', message: 'Message too large' }); return; }
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

      if (message.type.startsWith('terminal_') && 'executionId' in message) {
        const id = message.executionId;
        if (!subscriptions.has(id)) {
          send({ type: 'terminal_state', executionId: id, state: 'closed', error: 'not_subscribed' });
          return;
        }
        try {
          const current = ctx.executions.get(id);
          if (!current.interactive) {
            send({ type: 'terminal_state', executionId: id, state: 'closed', error: 'not_interactive' });
            return;
          }
          if (current.status !== 'running' && current.status !== 'queued') {
            controllers.delete(id);
            send({ type: 'terminal_state', executionId: id, state: 'closed', error: 'not_running' });
            return;
          }
          if (message.type === 'terminal_release') { release(id); terminalState(id); return; }
          const terminal = ctx.executions.terminal(id);
          if (!terminal) { terminalState(id, 'not_ready'); return; }
          if (message.type === 'terminal_claim') {
            if (!controllers.has(id)) controllers.set(id, connection);
            ctx.hub.publish(id, { type: 'terminal_state', executionId: id, state: 'available' });
            return;
          }
          if (controllers.get(id) !== connection) { terminalState(id, 'not_controller'); return; }
          if (message.type === 'terminal_input') {
            if (!terminal.write(message.data)) terminalState(id, 'input_overflow');
          } else if (message.type === 'terminal_resize') terminal.resize(message.cols, message.rows);
        } catch (error) {
          send({ type: 'terminal_state', executionId: id, state: 'closed',
            error: error instanceof NotFoundError ? 'not_found' : 'not_ready' });
        }
        return;
      }

      if (message.type === 'unsubscribe') {
        subscriptions.get(message.executionId)?.();
        subscriptions.delete(message.executionId);
        release(message.executionId);
        return;
      }

      if (message.type !== 'subscribe') return;

      // Subscribing to an unknown id is a client bug. Say so, rather than
      // leaving the caller waiting for events that will never arrive.
      try {
        const execution = ctx.executions.get(message.executionId);
        if (subscriptions.has(message.executionId)) {
          send({ type: 'status', execution });
          send({ type: 'subscribed', executionId: message.executionId });
          return;
        }
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof NotFoundError ? 'No such execution' : 'Cannot subscribe',
        });
        return;
      }

      subscriptions.set(
        message.executionId,
        ctx.hub.subscribe(message.executionId, (event) => {
          if (event.type === 'terminal_state') {
            if (event.state === 'closed') { controllers.delete(message.executionId); send(event); }
            else terminalState(message.executionId);
          } else send(event);
        }),
      );
      // Reconnect can miss a final status, so read it after installing the listener.
      send({ type: 'status', execution: ctx.executions.get(message.executionId) });
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
