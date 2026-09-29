import { readFile } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';
import {
  createSourceSchema,
  runDraftSchema,
  updateSourceSchema,
  type ScriptSummary,
} from '@dashboard/shared';
import { z } from 'zod';

import type { AppContext } from '../context.js';
import { NotFoundError } from '../lib/errors.js';
import { joinRoot } from '../lib/paths.js';
import { getExecution } from '../services/executions.js';
import { getRunPrefill, saveRunDraft } from '../services/run-draft.js';
import {
  browseMount,
  createSource,
  deleteSource,
  getSource,
  getSourceRow,
  getSourceTree,
  listSources,
  sourceDirectory,
  syncSource,
  toScriptSummary,
  updateSource,
  type ScriptRow,
} from '../services/sources.js';

const listScriptsQuery = z.object({
  sourceId: z.string().optional(),
  q: z.string().optional(),
});

const updateScriptSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  timeoutSec: z.number().int().min(1).max(86_400).nullable().optional(),
  interpreterOverride: z.array(z.string().min(1)).min(1).nullable().optional(),
});

/** Source snippet shown in the detail pane is capped at this many characters. */
const MAX_SNIPPET_CHARS = 200_000;

export function registerSourceRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ---------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------

  app.get('/api/sources', () => listSources(ctx.db));

  app.post('/api/sources', (request, reply) => {
    const input = createSourceSchema.parse(request.body);
    return reply.code(201).send(createSource(ctx.db, ctx.config, input));
  });

  app.get<{ Params: { id: string } }>('/api/sources/:id', (request) =>
    getSource(ctx.db, request.params.id),
  );

  app.patch<{ Params: { id: string } }>('/api/sources/:id', (request) => {
    const input = updateSourceSchema.parse(request.body);
    return updateSource(ctx.db, ctx.config, request.params.id, input);
  });

  app.delete<{ Params: { id: string }; Querystring: { removeFiles?: string } }>(
    '/api/sources/:id',
    (request, reply) => {
      // Deleting the checkout is destructive and separate from forgetting the
      // source, so it has to be asked for explicitly.
      deleteSource(ctx.db, ctx.config, request.params.id, request.query.removeFiles === 'true');
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>('/api/sources/:id/sync', (request) =>
    syncSource(ctx.db, ctx.config, request.params.id, ctx.logger),
  );

  app.get<{ Params: { id: string } }>('/api/sources/:id/tree', (request) =>
    getSourceTree(ctx.db, request.params.id),
  );

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/sources/:id/browse',
    (request) => browseMount(ctx.config, request.query.path ?? ''),
  );

  // ---------------------------------------------------------------------
  // Scripts
  // ---------------------------------------------------------------------

  app.get('/api/scripts', (request) => {
    const query = listScriptsQuery.parse(request.query);
    const clauses = ['deleted_at IS NULL'];
    const params: string[] = [];

    if (query.sourceId) {
      clauses.push('source_id = ?');
      params.push(query.sourceId);
    }
    if (query.q) {
      clauses.push('(display_name LIKE ? OR rel_path LIKE ?)');
      const pattern = `%${query.q}%`;
      params.push(pattern, pattern);
    }

    const rows = ctx.db
      .prepare<string[], ScriptRow>(
        `SELECT * FROM scripts WHERE ${clauses.join(' AND ')}
         ORDER BY rel_path COLLATE NOCASE LIMIT 1000`,
      )
      .all(...params);

    return rows.map(toScriptSummary);
  });

  app.get<{ Params: { id: string } }>('/api/scripts/:id', async (request) => {
    const script = loadScript(ctx, request.params.id);
    const source = getSourceRow(ctx.db, script.sourceId);

    // The snippet is a convenience for the detail pane. Read it from the
    // mounted directory, bounded, and never fail the request over it: the file
    // may have disappeared between a sync and this call.
    const content = await readFile(
      joinRoot(sourceDirectory(ctx.config, source), script.relPath),
      'utf8',
    )
      .then((text) => (text.length > MAX_SNIPPET_CHARS ? text.slice(0, MAX_SNIPPET_CHARS) : text))
      .catch(() => null);

    return { ...script, content };
  });

  // The run form's memory of itself: what it held last time, and where that came
  // from. Separate from the script resource because it is per-form state that
  // the client writes as the operator types.
  app.get<{ Params: { id: string } }>('/api/scripts/:id/run-draft', (request) =>
    getRunPrefill(ctx.db, request.params.id),
  );

  app.put<{ Params: { id: string } }>('/api/scripts/:id/run-draft', (request) =>
    saveRunDraft(ctx.db, request.params.id, runDraftSchema.parse(request.body)),
  );

  app.patch<{ Params: { id: string } }>('/api/scripts/:id', (request) => {
    const input = updateScriptSchema.parse(request.body);
    const existing = loadScript(ctx, request.params.id);

    ctx.db
      .prepare(
        `UPDATE scripts SET
           display_name = ?, description = ?, timeout_sec = ?, interpreter_override_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.displayName ?? existing.displayName,
        input.description === undefined ? existing.description : input.description,
        input.timeoutSec === undefined ? existing.timeoutSec : input.timeoutSec,
        serializeOverride(input, existing),
        new Date().toISOString(),
        existing.id,
      );

    return loadScript(ctx, existing.id);
  });

  // ---------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------

  app.get('/api/overview', () => {
    const count = (sql: string): number =>
      ctx.db.prepare<[], { count: number }>(sql).get()?.count ?? 0;

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const failed24h =
      ctx.db
        .prepare<[string], { count: number }>(
          `SELECT COUNT(*) AS count FROM executions
           WHERE status IN ('failed','timed_out') AND queued_at >= ?`,
        )
        .get(since)?.count ?? 0;

    const recentRows = ctx.db
      .prepare<[number], { id: string }>(
        'SELECT id FROM executions ORDER BY queued_at DESC, rowid DESC LIMIT ?',
      )
      .all(10);

    return {
      counts: {
        targets: count('SELECT COUNT(*) AS count FROM targets'),
        sources: count('SELECT COUNT(*) AS count FROM sources'),
        scripts: count('SELECT COUNT(*) AS count FROM scripts WHERE deleted_at IS NULL'),
        running: count("SELECT COUNT(*) AS count FROM executions WHERE status = 'running'"),
        failed24h,
      },
      recent: recentRows.map((row) => getExecution(ctx.db, row.id)),
      // Whether the AAAA record still points here is a dashboard-level fact, so
      // it rides along with the counts rather than costing the overview page a
      // second request that would answer from the same process anyway.
      dns: ctx.dns.consistency(),
    };
  });
}

/** Load a script by id, or explain that it is gone. */
function loadScript(ctx: AppContext, id: string): ScriptSummary {
  const row = ctx.db
    .prepare<[string], ScriptRow>('SELECT * FROM scripts WHERE id = ? AND deleted_at IS NULL')
    .get(id);
  if (!row) throw new NotFoundError('Script');
  return toScriptSummary(row);
}

/**
 * Resolve the interpreter override for an update.
 *
 * `undefined` means "leave as-is" and `null` means "clear it", which are
 * different intentions that a plain `??` would collapse.
 */
function serializeOverride(
  input: z.infer<typeof updateScriptSchema>,
  existing: ScriptSummary,
): string | null {
  if (input.interpreterOverride === undefined) {
    return existing.interpreterOverride ? JSON.stringify(existing.interpreterOverride) : null;
  }
  return input.interpreterOverride ? JSON.stringify(input.interpreterOverride) : null;
}

