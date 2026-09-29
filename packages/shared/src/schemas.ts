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
// IPv6 DNS console
// ---------------------------------------------------------------------------

export const dnsProviderSchema = z.enum(['cloudflare', 'alibaba']);
export type DnsProviderName = z.infer<typeof dnsProviderSchema>;

export const dnsActionSchema = z.enum(['created', 'updated', 'unchanged', 'failed']);
export type DnsAction = z.infer<typeof dnsActionSchema>;

export const dnsCheckSourceSchema = z.enum(['manual', 'scheduled']);
export type DnsCheckSource = z.infer<typeof dnsCheckSourceSchema>;

/**
 * Why a run ended with `action: 'failed'`.
 *
 * A code rather than a sentence: the client renders it, so the same value reads
 * the same way in the live result, a history row and the summary, and rewording
 * one never needs a migration.
 */
export const dnsFailureReasonSchema = z.enum([
  'not_configured',
  'invalid_settings',
  'ipv6_detect_failed',
  'ipv6_not_global',
  'dns_query_failed',
  'dns_write_failed',
  'record_missing',
  'record_identity_missing',
]);
export type DnsFailureReason = z.infer<typeof dnsFailureReasonSchema>;

/** A minute is the floor because anything shorter is a busy loop; a week is the ceiling. */
export const MIN_DNS_INTERVAL_MINUTES = 1;
export const MAX_DNS_INTERVAL_MINUTES = 10_080;

/**
 * A settings update carries only what changed.
 *
 * A secret field left out -- or sent blank -- keeps the stored value, because
 * the API never returns one for the client to send back. Deleting a credential
 * is therefore its own explicit flag: it has to be asked for, rather than
 * happening because someone cleared a box and pressed save.
 */
export const updateDnsSettingsSchema = z.object({
  provider: dnsProviderSchema.optional(),
  scheduleEnabled: z.boolean().optional(),
  intervalMinutes: z
    .number()
    .int()
    .min(MIN_DNS_INTERVAL_MINUTES)
    .max(MAX_DNS_INTERVAL_MINUTES)
    .optional(),
  cloudflareZoneId: z.string().max(200).optional(),
  cloudflareRecordName: z.string().max(255).optional(),
  cloudflareToken: z.string().max(500).optional(),
  alibabaAccessKeyId: z.string().max(200).optional(),
  alibabaRecordId: z.string().max(200).optional(),
  alibabaAccessKeySecret: z.string().max(500).optional(),
  gotifyAddress: z.string().max(500).optional(),
  gotifyToken: z.string().max(500).optional(),
  clearCloudflareToken: z.boolean().optional(),
  clearAlibabaAccessKeySecret: z.boolean().optional(),
  clearGotifyToken: z.boolean().optional(),
});
export type UpdateDnsSettingsInput = z.infer<typeof updateDnsSettingsSchema>;

/**
 * The test message is sent with the form's current values, so a credential can
 * be verified before it is saved. Only the two fields it uses are accepted.
 */
export const testDnsNotificationSchema = updateDnsSettingsSchema.pick({
  gotifyAddress: true,
  gotifyToken: true,
});
export type TestDnsNotificationInput = z.infer<typeof testDnsNotificationSchema>;

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

/** How many history rows the state payload previews. */
export const DNS_CHECK_PREVIEW = 5;

/** How many history rows are kept. Older ones are deleted as new ones arrive. */
export const MAX_DNS_CHECKS = 500;

/**
 * The settings as the API returns them.
 *
 * No field here can carry a secret: each credential is reduced to whether it is
 * stored, which is all the form needs to render a password box whose emptiness
 * means "leave it alone". This is the `TargetSummary` rule applied again --
 * rather than remembering to strip a field, there is no field to strip.
 */
export type DnsSettingsView = {
  provider: DnsProviderName;
  scheduleEnabled: boolean;
  intervalMinutes: number;
  cloudflareZoneId: string;
  cloudflareRecordName: string;
  hasCloudflareToken: boolean;
  alibabaAccessKeyId: string;
  alibabaRecordId: string;
  /** Fixed: updating an IPv6 record is updating an AAAA record. */
  alibabaRecordType: 'AAAA';
  hasAlibabaAccessKeySecret: boolean;
  gotifyAddress: string;
  hasGotifyToken: boolean;
  updatedAt: string;
};

export type DnsRecord = {
  provider: DnsProviderName;
  /**
   * Cloudflare reports the full name; Alibaba reports the host record (`rr`)
   * because that is what its update call needs back. The two are not
   * interchangeable, so neither is normalised into the other.
   */
  recordName: string;
  recordType: string;
  value: string;
  recordId: string;
  /** Cloudflare only; null when the API did not report a real boolean. */
  proxied: boolean | null;
  /** Cloudflare only; null when the API did not report a real integer. */
  ttl: number | null;
};

export type DnsUpdateResult = {
  /** Null when the run failed before a provider had been chosen at all. */
  provider: DnsProviderName | null;
  action: DnsAction;
  /** The address this run detected; empty when detection is what failed. */
  ipv6: string;
  previousValue: string | null;
  recordName: string;
  /** Set only alongside `action: 'failed'`. */
  failureReason: DnsFailureReason | null;
  /** True when a notification was warranted (created or updated) and attempted. */
  notificationAttempted: boolean;
  /** A failed notification is reported, never allowed to fail the run. */
  notificationFailed: boolean;
};

export type DnsCheck = {
  id: string;
  at: string;
  source: DnsCheckSource;
  ok: boolean;
  action: DnsAction;
  failureReason: DnsFailureReason | null;
  ipv6: string;
  previousValue: string | null;
  /** Null when the run failed before a provider had been chosen at all. */
  provider: DnsProviderName | null;
};

export type DnsCheckSummary = {
  total: number;
  succeeded: number;
  failed: number;
  /** Created plus updated: a run that actually wrote something. */
  changed: number;
  lastRunAt: string | null;
  lastChangeAt: string | null;
};

export type DnsCheckList = {
  items: DnsCheck[];
  total: number;
};

export type DnsSchedulerView = {
  enabled: boolean;
  /** A check is running right now. */
  running: boolean;
  intervalMinutes: number;
  /** When the next scheduled check is due; null while the schedule is off. */
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastFailureReason: DnsFailureReason | null;
};

export type DnsState = {
  /**
   * Null until the settings have been saved once. The page has to tell "never
   * configured" from "configured and empty", because only the first should send
   * the operator to the form as the next step.
   */
  settings: DnsSettingsView | null;
  /** The last address a check detected, held in memory and lost on restart. */
  ipv6: string | null;
  ipv6CheckedAt: string | null;
  record: DnsRecord | null;
  recordCheckedAt: string | null;
  schedule: DnsSchedulerView | null;
  history: {
    summary: DnsCheckSummary;
    records: DnsCheck[];
    total: number;
  };
  limits: {
    historyPreviewSize: number;
    historyMaxRecords: number;
  };
};

export type DnsIpv6Probe = {
  ipv6: string;
  detectedAt: string;
};

export type DnsRecordProbe = {
  /** Null means the provider has no AAAA record yet, which is not an error. */
  record: DnsRecord | null;
  queriedAt: string;
};

export type DnsNotificationTest = {
  sent: true;
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
