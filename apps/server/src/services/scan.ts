/**
 * Discover scripts inside a source directory.
 *
 * The directory is the bind-mounted one, so this runs entirely in the container
 * with ordinary filesystem calls -- no SSH, no remote shell, and therefore no
 * command-injection surface for the file walk itself.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { ScriptParam, ScriptMeta } from '@dashboard/shared';
import { parseScriptMeta } from '@dashboard/shared';

import type { Db } from '../db/client.js';
import { nowIso } from '../db/client.js';
import { newScriptId } from '../lib/ids.js';

/** Extensions the dashboard knows how to run. */
const SUPPORTED_EXTENSIONS = new Set(['.sh', '.ps1']);

/**
 * Directories never worth walking. `.git` alone can contain thousands of files;
 * `.dashboard` is our own internal state directory.
 */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.dashboard', '.idea', '.vscode']);

/** Guardrails so a hostile or accidental layout cannot hang the scan. */
const MAX_DEPTH = 12;
/** Exported so the submit path enforces the same cap the scanner does. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 5_000;

export type DiscoveredScript = {
  relPath: string;
  relDir: string;
  fileName: string;
  format: 'sh' | 'ps1';
  sizeBytes: number;
  contentHash: string;
  meta: ScriptMeta;
};

export type ScanOutcome = {
  scripts: DiscoveredScript[];
  warnings: string[];
  /** True when a guardrail stopped the walk before it finished. */
  incomplete: boolean;
};

/** Split a root-relative path into its directory and file name parts. */
function splitRelative(relPath: string): { relDir: string; fileName: string } {
  const index = relPath.lastIndexOf('/');
  if (index === -1) return { relDir: '', fileName: relPath };
  return { relDir: relPath.slice(0, index), fileName: relPath.slice(index + 1) };
}

export async function scanSourceDirectory(rootAbsolute: string): Promise<ScanOutcome> {
  const scripts: DiscoveredScript[] = [];
  const warnings: string[] = [];
  let incomplete = false;
  let visited = 0;

  async function walk(absolute: string, relDir: string, depth: number): Promise<void> {
    if (incomplete) return;
    if (depth > MAX_DEPTH) {
      warnings.push(`Stopped at ${relDir || '.'}: directory nesting exceeds ${MAX_DEPTH} levels`);
      incomplete = true;
      return;
    }

    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch (error) {
      warnings.push(
        `Could not read ${relDir || '.'}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    for (const entry of entries) {
      if (incomplete) return;
      if (visited >= MAX_FILES) {
        warnings.push(`Stopped after ${MAX_FILES} files; the source is larger than the scan limit`);
        incomplete = true;
        return;
      }

      const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;

      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        await walk(join(absolute, entry.name), relPath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;

      const dotIndex = entry.name.lastIndexOf('.');
      if (dotIndex === -1) continue;
      const extension = entry.name.slice(dotIndex).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) continue;

      visited += 1;
      const filePath = join(absolute, entry.name);

      try {
        const info = await stat(filePath);
        if (info.size > MAX_FILE_BYTES) {
          warnings.push(
            `${relPath} skipped: ${Math.round(info.size / 1024)} KB exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit`,
          );
          continue;
        }

        const content = await readFile(filePath);
        const meta = parseScriptMeta(content.toString('utf8'));
        const { relDir: scriptDir, fileName } = splitRelative(relPath);

        scripts.push({
          relPath,
          relDir: scriptDir,
          fileName,
          format: extension === '.ps1' ? 'ps1' : 'sh',
          sizeBytes: info.size,
          contentHash: createHash('sha256').update(content).digest('hex'),
          meta,
        });
      } catch (error) {
        warnings.push(`${relPath} skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await walk(rootAbsolute, '', 0);
  scripts.sort((left, right) => left.relPath.localeCompare(right.relPath));

  return { scripts, warnings, incomplete };
}

export type SyncCounts = {
  added: number;
  updated: number;
  removed: number;
  total: number;
};

/** Row shape needed to decide whether a script changed. */
type ExistingScriptRow = {
  id: string;
  rel_path: string;
  content_hash: string;
  size_bytes: number;
};

/**
 * Reconcile the database with what the scan found.
 *
 * Scripts that disappeared are marked deleted rather than removed: their
 * execution history has to stay readable, and a file that returns in a later
 * sync should be recognisable as the same script.
 */
export function syncScripts(db: Db, sourceId: string, discovered: DiscoveredScript[]): SyncCounts {
  const existing = db
    .prepare<[string], ExistingScriptRow>(
      'SELECT id, rel_path, content_hash, size_bytes FROM scripts WHERE source_id = ?',
    )
    .all(sourceId);

  const byPath = new Map(existing.map((row) => [row.rel_path, row]));
  const seen = new Set<string>();
  const timestamp = nowIso();

  let added = 0;
  let updated = 0;

  const insert = db.prepare(
    `INSERT INTO scripts (
       id, source_id, rel_path, rel_dir, file_name, format, size_bytes, content_hash,
       display_name, description, params_json, timeout_sec, discovered_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );

  const update = db.prepare(
    `UPDATE scripts SET
       content_hash = ?, size_bytes = ?, display_name = ?, description = ?,
       params_json = ?, timeout_sec = ?, updated_at = ?, deleted_at = NULL
     WHERE id = ?`,
  );

  const apply = db.transaction(() => {
    for (const script of discovered) {
      seen.add(script.relPath);
      const displayName = script.meta.name ?? script.fileName;
      const paramsJson = JSON.stringify(script.meta.params satisfies ScriptParam[]);

      const previous = byPath.get(script.relPath);

      if (!previous) {
        insert.run(
          newScriptId(),
          sourceId,
          script.relPath,
          script.relDir,
          script.fileName,
          script.format,
          script.sizeBytes,
          script.contentHash,
          displayName,
          script.meta.description,
          paramsJson,
          script.meta.timeoutSec,
          timestamp,
          timestamp,
        );
        added += 1;
        continue;
      }

      // Only rewrite metadata when the bytes changed, so a user's edits to the
      // display name or timeout survive syncs of unchanged files.
      if (previous.content_hash === script.contentHash && previous.size_bytes === script.sizeBytes) {
        // Still clear a previous soft-delete: the file is present again.
        db.prepare('UPDATE scripts SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(previous.id);
        continue;
      }

      update.run(
        script.contentHash,
        script.sizeBytes,
        displayName,
        script.meta.description,
        paramsJson,
        script.meta.timeoutSec,
        timestamp,
        previous.id,
      );
      updated += 1;
    }

    // Anything the scan did not see is gone from the working tree.
    for (const row of existing) {
      if (seen.has(row.rel_path)) continue;
      db.prepare('UPDATE scripts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
        timestamp,
        timestamp,
        row.id,
      );
    }
  });

  apply();

  const removed = existing.filter((row) => !seen.has(row.rel_path)).length;

  return { added, updated, removed, total: discovered.length };
}
