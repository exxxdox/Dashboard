import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, constants, closeSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { parseScriptMeta, type CreateScriptInput, type ScriptContent, type ScriptSummary, type UpdateScriptContentInput } from '@dashboard/shared';
import type { AppConfig } from '../config.js';
import { type Db, nowIso } from '../db/client.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { assertSafeRelative, isInside, joinRoot, relativeDir } from '../lib/paths.js';
import { MAX_DEPTH, MAX_FILE_BYTES, SKIPPED_DIRECTORIES, SUPPORTED_EXTENSIONS, syncScripts } from './scan.js';
import { getSourceRow, sourceDirectory, toScriptSummary, type ScriptRow, type SourceRow } from './sources.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function invalidPath(): never {
  throw new ValidationError('Choose a relative .sh or .ps1 path without hidden or reserved directories', undefined, { key: 'scripts.error.invalidPath' });
}

function safePath(relPath: string): string {
  try {
    if (assertSafeRelative(relPath) !== relPath) invalidPath();
  } catch { invalidPath(); }
  const segments = relPath.split('/');
  if (segments.length > MAX_DEPTH + 1 || segments.some((segment) => !segment || segment.startsWith('.') || SKIPPED_DIRECTORIES.has(segment)) || /[\x00-\x1f\x7f]/.test(relPath) || !SUPPORTED_EXTENSIONS.has(extname(relPath).toLowerCase())) invalidPath();
  return relPath;
}

function sourceForWrite(db: Db, sourceId: string): SourceRow {
  const source = getSourceRow(db, sourceId);
  if (source.kind !== 'local') throw new ValidationError('GitHub scripts are read-only', undefined, { key: 'scripts.error.readOnly' });
  // Sync reads asynchronously; refusing changes until it settles keeps its snapshot authoritative.
  if (source.sync_status === 'syncing') throw new ConflictError('Wait for source synchronization to finish', { key: 'scripts.error.syncing' });
  return source;
}

function scriptRow(db: Db, id: string): ScriptRow {
  const row = db.prepare<[string], ScriptRow>('SELECT * FROM scripts WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) throw new NotFoundError('Script');
  return row;
}

function filePath(db: Db, config: AppConfig, source: SourceRow, relPath: string, createParents = false): string {
  safePath(relPath);
  const absolute = joinRoot(sourceDirectory(config, source), relPath);
  // A local source may contain another source's checkout; its kind cannot grant write access to GitHub files.
  for (const github of db.prepare<[], SourceRow>("SELECT * FROM sources WHERE kind = 'github'").all()) {
    if (isInside(sourceDirectory(config, github), absolute)) throw new ValidationError('GitHub scripts are read-only', undefined, { key: 'scripts.error.readOnly' });
  }
  const rootInfo = lstatSync(config.scriptRootContainer);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) invalidPath();
  const relative = absolute.slice(config.scriptRootContainer.replace(/\/$/, '').length + 1);
  let directory = config.scriptRootContainer;
  // Check every ancestor, including the source mount, because lexical containment does not stop symlinks.
  for (const segment of relative.split('/').slice(0, -1)) {
    directory = join(directory, segment);
    try {
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) invalidPath();
    } catch (error) {
      if (createParents && error instanceof Error && 'code' in error && error.code === 'ENOENT') mkdirSync(directory);
      else throw error;
    }
  }
  return absolute;
}

function readBytes(path: string): { bytes: Buffer; mode: number } {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1) invalidPath();
    if (info.size > MAX_FILE_BYTES) throw new ValidationError('Scripts must not exceed 2 MiB', undefined, { key: 'scripts.error.tooLarge' });
    const bytes = readFileSync(fd);
    if (bytes.length > MAX_FILE_BYTES) throw new ValidationError('Scripts must not exceed 2 MiB', undefined, { key: 'scripts.error.tooLarge' });
    // Refuse lossy decoding rather than letting an editor silently corrupt the original bytes.
    if (!Buffer.from(bytes.toString('utf8')).equals(bytes)) throw new ValidationError('Only UTF-8 scripts can be edited', undefined, { key: 'scripts.error.encoding' });
    return { bytes, mode: info.mode & 0o777 };
  } finally { closeSync(fd); }
}

function contentBytes(content: string): Buffer {
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > MAX_FILE_BYTES) throw new ValidationError('Scripts must not exceed 2 MiB', undefined, { key: 'scripts.error.tooLarge' });
  return bytes;
}

function expectHash(bytes: Buffer, expectedHash: string): void {
  if (hash(bytes) !== expectedHash) throw new ConflictError('The script changed; reload before saving or deleting', { key: 'scripts.error.changed' });
}

function persistMetadata(db: Db, sourceId: string, relPath: string, bytes: Buffer): ScriptSummary {
  const fileName = relPath.split('/').at(-1)!;
  // Partial reconciliation shares the scanner's metadata rules without deleting unseen siblings.
  syncScripts(db, sourceId, [{ relPath, relDir: relativeDir(relPath), fileName, format: extname(relPath).toLowerCase() === '.ps1' ? 'ps1' : 'sh', sizeBytes: bytes.length, contentHash: hash(bytes), meta: parseScriptMeta(bytes.toString('utf8')) }], { removeMissing: false });
  const row = db.prepare<[string, string], ScriptRow>('SELECT * FROM scripts WHERE source_id = ? AND rel_path = ?').get(sourceId, relPath)!;
  return toScriptSummary(row);
}

function fileOperation<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new ConflictError('A file already exists at this path', { key: 'scripts.error.exists' });
    if (error instanceof Error && 'code' in error && error.code === 'ELOOP') invalidPath();
    throw new ValidationError('Cannot access this script file; check its path and permissions', undefined, { key: 'scripts.error.fileAccess' });
  }
}

export function getScriptContent(db: Db, config: AppConfig, id: string): ScriptContent {
  return fileOperation(() => {
    const row = scriptRow(db, id);
    const source = sourceForWrite(db, row.source_id);
    const { bytes } = readBytes(filePath(db, config, source, row.rel_path));
    return { content: bytes.toString('utf8'), contentHash: hash(bytes) };
  });
}

export function createScriptFile(db: Db, config: AppConfig, sourceId: string, input: CreateScriptInput): ScriptSummary {
  return fileOperation(() => {
    const source = sourceForWrite(db, sourceId);
    const bytes = contentBytes(input.content);
    const path = filePath(db, config, source, input.relPath, true);
    const temporary = join(dirname(path), `.dashboard-${randomUUID()}.tmp`);
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o644 });
    let created = false;
    try {
      // Linking is exclusive and publishes complete bytes; rename would overwrite an existing file.
      linkSync(temporary, path);
      created = true;
      return persistMetadata(db, sourceId, input.relPath, bytes);
    } catch (error) {
      if (created) unlinkSync(path);
      throw error;
    } finally { unlinkSync(temporary); }
  });
}

export function updateScriptContent(db: Db, config: AppConfig, id: string, input: UpdateScriptContentInput): ScriptSummary {
  return fileOperation(() => {
    const row = scriptRow(db, id);
    const source = sourceForWrite(db, row.source_id);
    const bytes = contentBytes(input.content);
    const path = filePath(db, config, source, row.rel_path);
    const original = readBytes(path);
    expectHash(original.bytes, input.expectedHash);
    const temporary = join(dirname(path), `.dashboard-${randomUUID()}.tmp`);
    writeFileSync(temporary, bytes, { flag: 'wx', mode: original.mode });
    // umask applies to newly created files, but saving must retain the script's executable bits.
    chmodSync(temporary, original.mode);
    let replaced = false;
    try {
      return db.transaction(() => {
        const script = persistMetadata(db, row.source_id, row.rel_path, bytes);
        // A complete replacement leaves either the old or the new script available to runners.
        renameSync(temporary, path);
        replaced = true;
        return script;
      })();
    } catch (error) {
      // A failed SQLite commit must not leave new file bytes paired with rolled-back metadata.
      if (replaced) {
        writeFileSync(temporary, original.bytes, { flag: 'wx', mode: original.mode });
        chmodSync(temporary, original.mode);
        renameSync(temporary, path);
      }
      throw error;
    } finally {
      try { unlinkSync(temporary); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    }
  });
}

export function deleteScriptFile(db: Db, config: AppConfig, id: string, expectedHash: string): void {
  fileOperation(() => {
    const row = scriptRow(db, id);
    const source = sourceForWrite(db, row.source_id);
    const path = filePath(db, config, source, row.rel_path);
    expectHash(readBytes(path).bytes, expectedHash);
    const temporary = join(dirname(path), `.dashboard-${randomUUID()}.tmp`);
    renameSync(path, temporary);
    try {
      db.transaction(() => {
        const timestamp = nowIso();
        db.prepare('UPDATE scripts SET deleted_at = ?, updated_at = ? WHERE id = ?').run(timestamp, timestamp, id);
        // Recreating the same path must not silently resume its former scheduled invocations.
        db.prepare('UPDATE script_schedules SET enabled = 0, next_run_at = NULL, updated_at = ? WHERE script_id = ?').run(timestamp, id);
      })();
    } catch (error) {
      renameSync(temporary, path);
      throw error;
    }
    unlinkSync(temporary);
  });
}


export function updateScriptMetadata(db: Db, config: AppConfig, id: string, input: {
  displayName?: string;
  description?: string | null;
  timeoutSec?: number | null;
  interpreterOverride?: string[] | null;
}): ScriptSummary {
  return fileOperation(() => {
    const row = scriptRow(db, id);
    const source = getSourceRow(db, row.source_id);
    let name = input.displayName ?? row.display_name;
    let relPath = row.rel_path;
    let originalPath: string | undefined;
    let destination: string | undefined;
    if (source.kind === 'local' && input.displayName !== undefined) {
      name = input.displayName.trim();
      if (!name || name.includes('/') || name.includes('\\')) invalidPath();
      if (!extname(name)) name += extname(row.file_name);
      // A name edit must not silently switch the interpreter or move directories.
      if (extname(name).toLowerCase() !== extname(row.file_name).toLowerCase()) invalidPath();
      relPath = safePath(row.rel_dir ? `${row.rel_dir}/${name}` : name);
      if (relPath !== row.rel_path) {
        sourceForWrite(db, row.source_id);
        originalPath = filePath(db, config, source, row.rel_path);
        readBytes(originalPath);
        destination = filePath(db, config, source, relPath);
        // Soft-deleted paths still own history; never replace their identity.
        if (db.prepare('SELECT id FROM scripts WHERE source_id = ? AND rel_path = ? AND id != ?').get(row.source_id, relPath, id)) {
          throw new ConflictError('A script already exists at this path', { key: 'scripts.error.exists' });
        }
      }
    }
    let linked = false;
    let removed = false;
    try {
      return db.transaction(() => {
        if (originalPath && destination) {
          // Exclusive publication preserves permissions and refuses to overwrite even an unscanned file.
          linkSync(originalPath, destination);
          linked = true;
          unlinkSync(originalPath);
          removed = true;
        }
        db.prepare(`UPDATE scripts SET display_name = ?, rel_path = ?, file_name = ?, description = ?, timeout_sec = ?, interpreter_override_json = ?, updated_at = ? WHERE id = ?`).run(
          name, relPath, relPath.split('/').at(-1)!,
          input.description === undefined ? row.description : input.description,
          input.timeoutSec === undefined ? row.timeout_sec : input.timeoutSec,
          input.interpreterOverride === undefined ? row.interpreter_override_json : input.interpreterOverride === null ? null : JSON.stringify(input.interpreterOverride),
          nowIso(), id,
        );
        return toScriptSummary(scriptRow(db, id));
      })();
    } catch (error) {
      // SQLite failures must restore the old file path together with the old metadata.
      if (linked && originalPath && destination) {
        if (removed) linkSync(destination, originalPath);
        unlinkSync(destination);
      }
      throw error;
    }
  });
}
