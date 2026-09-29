/**
 * Wire contracts shared by the API and the web client.
 *
 * Every response body is validated on the way in and typed on the way out from
 * these schemas, so a change here is the single place that has to be kept in
 * step with the frontend.
 */

import { z } from 'zod';
import {
  MAX_ARGV_LENGTH,
  MAX_PARAM_COUNT,
  MAX_PARAM_NAME_LENGTH,
  type ScriptParam,
} from './script-meta.js';

/** Timestamps are ISO 8601 UTC strings, e.g. "2026-09-27T12:34:56.789Z". */
export const isoDateTime = z.string();

export const scriptFormatSchema = z.enum(['sh', 'ps1']);
export type ScriptFormat = z.infer<typeof scriptFormatSchema>;

export const sourceKindSchema = z.enum(['local', 'github']);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const syncStatusSchema = z.enum(['never', 'syncing', 'ok', 'error']);
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const executionStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
  'timed_out',
  'interrupted',
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const TERMINAL_EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  'succeeded',
  'failed',
  'canceled',
  'timed_out',
  'interrupted',
];

export const targetAuthSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('key'),
    privateKey: z.string().min(1, 'Private key is required'),
    passphrase: z.string().optional(),
  }),
  z.object({
    method: z.literal('password'),
    password: z.string().min(1, 'Password is required'),
  }),
]);
export type TargetAuth = z.infer<typeof targetAuthSchema>;

export const createTargetSchema = z.object({
  name: z.string().min(1).max(100),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65_535).default(22),
  username: z.string().min(1).max(100),
  auth: targetAuthSchema,
  /**
   * Absolute directory on the host that scripts run in. It has nothing to do
   * with any path in this container: the script is pushed to a staging
   * directory and merely run from here, so this only has to exist.
   */
  workDir: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => value.startsWith('/'), {
      message: 'Use an absolute path, e.g. /srv/scripts',
    }),
  connectTimeoutSec: z.number().int().min(1).max(120).default(15),
});
export type CreateTargetInput = z.infer<typeof createTargetSchema>;

export const updateTargetSchema = createTargetSchema.partial();
export type UpdateTargetInput = z.infer<typeof updateTargetSchema>;

export const createSourceSchema = z
  .object({
    name: z.string().min(1).max(100),
    kind: sourceKindSchema,
    /** Required for `github`; ignored for `local`. */
    repoUrl: z.string().min(1).optional(),
    branch: z.string().min(1).max(200).optional(),
    /**
     * For `github`: subdirectory inside the repo to treat as the root.
     * For `local`: path relative to the shared root that holds loose scripts.
     */
    subPath: z.string().max(1024).optional(),
  })
  .refine((value) => value.kind !== 'github' || Boolean(value.repoUrl), {
    message: 'repoUrl is required for a GitHub source',
    path: ['repoUrl'],
  });
export type CreateSourceInput = z.infer<typeof createSourceSchema>;

/**
 * An edit to an existing source.
 *
 * Every field is optional, so a caller sends only what changed. `kind` is absent
 * on purpose: it decides the shape of `mountPath` and therefore where the
 * checkout lives, so switching between local and GitHub would silently orphan
 * the files and strand every script path stored against the source.
 */
export const updateSourceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  repoUrl: z.string().min(1).optional(),
  /** `null` goes back to the repository's default branch. */
  branch: z.string().min(1).max(200).nullable().optional(),
  /** GitHub: subdirectory to scan from, `null` for the repository root. */
  subPath: z.string().max(1024).nullable().optional(),
});
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>;

export const executeScriptSchema = z.object({
  targetId: z.string().min(1),
  /** Parameter values, keyed by name. The script reads these from its environment. */
  params: z.record(z.string(), z.string()).default({}),
  /**
   * Positional arguments, in order, appended after the script path: the script
   * reads them as `$1`, `$2` … rather than from the environment. Quoted on
   * assembly (see `shell.ts`), so a value containing a space or a `;` stays one
   * argument.
   *
   * A script reads one channel or the other, never both, so which one an input
   * uses is the caller's decision per input.
   */
  argv: z.array(z.string().max(MAX_ARGV_LENGTH)).max(MAX_PARAM_COUNT).default([]),
  timeoutSec: z.number().int().min(1).max(86_400).optional(),
});
export type ExecuteScriptInput = z.infer<typeof executeScriptSchema>;

/**
 * Sign-in. There is no registration and no user list: the server compares this
 * against one username and password from its environment.
 */
export const loginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(1000),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * What the client needs to decide whether to render a login screen.
 *
 * `required` is the server telling the client which deployment this is: with no
 * credentials configured there is nothing to sign in to, and `signedIn` is
 * reported as true so the UI is not permanently blocked out of itself.
 */
export type AuthStatus = {
  required: boolean;
  signedIn: boolean;
};

/**
 * One row of the run form's custom list, as the form holds it.
 *
 * Stored raw, junk and all: a draft is whatever was in the boxes, so a
 * half-typed name is kept rather than rejected. Only the sizes are bounded.
 */
export const runDraftRowSchema = z.object({
  name: z.string().max(200),
  value: z.string().max(MAX_ARGV_LENGTH),
  mode: z.enum(['env', 'argv']),
});
export type RunDraftRow = z.infer<typeof runDraftRowSchema>;

/**
 * What a script's run form held, so the next visit can start from it.
 *
 * `timeoutSec` stays a string because that is what the field holds: blank means
 * "the script's own limit", and a half-typed number is not a number yet.
 */
export const runDraftSchema = z.object({
  /**
   * Parameter values, keyed by name.
   *
   * Bounded on all three axes, unlike the request body it arrives in: this is
   * the only shape that is stored and then rendered back as one input per entry,
   * so an uncapped map is both unbounded storage and an unbounded form. The
   * limits are the ones a run would accept anyway, so an oversized draft is
   * refused at the boundary rather than at submit.
   */
  params: z
    .record(z.string().max(MAX_PARAM_NAME_LENGTH), z.string().max(MAX_ARGV_LENGTH))
    .refine((record) => Object.keys(record).length <= MAX_PARAM_COUNT, {
      message: `At most ${MAX_PARAM_COUNT} parameters`,
    })
    .default({}),
  custom: z.array(runDraftRowSchema).max(MAX_PARAM_COUNT).default([]),
  timeoutSec: z.string().max(16).default(''),
});
export type RunDraft = z.infer<typeof runDraftSchema>;

/**
 * The values a run form should open with, and where they came from.
 *
 * A draft the operator typed wins; failing that, the last run of this script is
 * the best evidence of what they meant; failing that, the form is empty and the
 * declared defaults speak for themselves.
 */
export type ScriptRunPrefill = {
  source: 'draft' | 'last-run' | 'none';
  draft: RunDraft;
};

export const executionStreamSchema = z.enum(['stdout', 'stderr', 'system']);
export type ExecutionStream = z.infer<typeof executionStreamSchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export type TargetSummary = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: 'key' | 'password';
  workDir: string;
  connectTimeoutSec: number;
  createdAt: string;
  updatedAt: string;
  /** Result of the most recent readiness check. */
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckDetail: string | null;
};

export type SourceSummary = {
  id: string;
  name: string;
  kind: SourceKind;
  repoUrl: string | null;
  branch: string | null;
  subPath: string | null;
  /** Directory relative to the shared root, e.g. "repos/acme__ops". */
  mountPath: string;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncAt: string | null;
  scriptCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ScriptSummary = {
  id: string;
  sourceId: string;
  /** Path relative to the source root, e.g. "deploy/api.sh". */
  relPath: string;
  /** Directory relative to the source root; "" for the root. */
  relDir: string;
  fileName: string;
  format: ScriptFormat;
  sizeBytes: number;
  /** sha256 of the file content at discovery time. */
  contentHash: string;
  displayName: string;
  description: string | null;
  params: ScriptParam[];
  timeoutSec: number | null;
  interpreterOverride: string[] | null;
  discoveredAt: string;
  updatedAt: string;
};

export type ScriptTreeNode = {
  name: string;
  /** Path relative to the source root; unique within the tree. */
  path: string;
  type: 'dir' | 'file';
  children?: ScriptTreeNode[];
  script?: ScriptSummary;
};

export type ExecutionSummary = {
  id: string;
  scriptId: string;
  targetId: string;
  status: ExecutionStatus;
  /** Exit code of the remote process; null until it terminates. */
  exitCode: number | null;
  /** Terminating signal name, when the process was killed rather than exited. */
  signal: string | null;
  /** Command as shown to the user, without wrapper plumbing. */
  commandDisplay: string;
  targetName: string;
  scriptName: string;
  scriptRelPath: string;
  paramValues: Record<string, string>;
  /** Positional arguments, in the order the script received them. */
  argv: string[];
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  /** Bytes of stdout+stderr captured; used to warn about truncation. */
  logBytes: number;
  truncated: boolean;
  errorMessage: string | null;
};

export type ExecutionLogChunk = {
  executionId: string;
  seq: number;
  stream: ExecutionStream;
  data: string;
  ts: string;
};

export type TargetCheckResult = {
  reachable: boolean;
  latencyMs: number | null;
  detail: string;
  /** Remote login shell, e.g. "bash 5.2.15". */
  hostShell: string | null;
  /** Remote user commands will run as. */
  hostUser: string | null;
  /**
   * Whether `setsid` exists on the host. Without it a cancelled run can only be
   * killed by pid, so child processes may survive.
   */
  hasSetsid: boolean;
  /** The configured working directory exists and can be entered, so `cd` works. */
  workDirOk: boolean;
  /**
   * A staging directory could be created, written, read back and removed. This
   * is the whole remote surface a run adds, so it is worth proving before the
   * first one rather than discovering it then.
   */
  stagingOk: boolean;
};

export type SyncResult = {
  sourceId: string;
  added: number;
  updated: number;
  removed: number;
  total: number;
  warnings: string[];
};

// ---------------------------------------------------------------------------
// WebSocket protocol
// ---------------------------------------------------------------------------

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), executionId: z.string().min(1) }),
  z.object({ type: z.literal('unsubscribe'), executionId: z.string().min(1) }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ServerMessage =
  | { type: 'hello'; serverTime: string }
  | { type: 'subscribed'; executionId: string }
  | { type: 'log'; chunk: ExecutionLogChunk }
  | { type: 'status'; execution: ExecutionSummary }
  | { type: 'pong' }
  | { type: 'error'; message: string };
