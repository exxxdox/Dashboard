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

// Retain the retired value so stored script snapshots and history remain readable.
export const scriptFormatSchema = z.enum(['sh', 'ps1']);
export type ScriptFormat = z.infer<typeof scriptFormatSchema>;

export const createScriptSchema = z.object({
  relPath: z.string().min(1).max(1000),
  content: z.string(),
});
export type CreateScriptInput = z.infer<typeof createScriptSchema>;

export const deleteScriptSchema = z.object({ expectedHash: z.string().regex(/^[a-f0-9]{64}$/) });
export type DeleteScriptInput = z.infer<typeof deleteScriptSchema>;
export const updateScriptContentSchema = deleteScriptSchema.extend({ content: z.string() });
export type UpdateScriptContentInput = z.infer<typeof updateScriptContentSchema>;
export type ScriptContent = { content: string; contentHash: string };

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

/**
 * Where a run executes on its target when the caller names no directory.
 *
 * A working directory belongs to one run, not to the host: two scripts may need
 * different directories, and the host's temporary directory is a usable default
 * that needs no configuration at all.
 */
export const DEFAULT_WORK_DIR = '/tmp';

/** An absolute POSIX directory a run may use as its working directory. */
export const workDirSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value.startsWith('/'), {
    message: 'Use an absolute path, e.g. /srv/scripts',
  });

export const createTargetSchema = z.object({
  name: z.string().min(1).max(100),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65_535).default(22),
  username: z.string().min(1).max(100),
  auth: targetAuthSchema,
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
  interactive: z.boolean().optional(),
  targetId: z.string().min(1),
  /**
   * Directory on the target this run executes in. Omitted means the host's
   * temporary directory; it is a value of the run rather than of the target so
   * each script can say where it needs to be.
   */
  workDir: workDirSchema.optional(),
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

// A schedule owns a snapshot; later edits to the run draft must not alter unattended runs.
export const saveScriptScheduleSchema = z.object({
  scriptId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  retentionDays: z.number().int().min(0).max(3650).default(30),
  cron: z.string().trim().min(1).max(200),
  timeZone: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  input: executeScriptSchema.refine((input) => !input.interactive, { message: 'Scheduled runs cannot use an interactive terminal' }),
});
export type SaveScriptScheduleInput = z.infer<typeof saveScriptScheduleSchema>;

export type ScriptSchedule = SaveScriptScheduleInput & {
  id: string;
  targetName: string;
  nextRunAt: string | null;
  lastTriggeredAt: string | null;
  lastExecutionId: string | null;
  /** Localized by the client; never contains submitted parameters or SSH errors. */
  lastError: 'submit_failed' | 'invalid_schedule' | null;
  updatedAt: string;
};

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

/**
 * What a script's run form held, so the next visit can start from it.
 *
 * `timeoutSec` stays a string because that is what the field holds: blank means
 * "the script's own limit", and a half-typed number is not a number yet.
 */
export const runDraftSchema = z.object({
  interactive: z.boolean().optional(),
  /** Raw box content, like `timeoutSec`: validation happens when the form submits. */
  workDir: z.string().max(4096).optional(),
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

export const dnsProviderSchema = z.enum(['cloudflare']);
export type DnsProviderName = z.infer<typeof dnsProviderSchema>;

export const dnsIpv6SourceSchema = z.enum(['ipify', 'local']);
export type DnsIpv6Source = z.infer<typeof dnsIpv6SourceSchema>;

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
  ipv6Source: dnsIpv6SourceSchema.optional(),
  localIpv6Interface: z.string().trim().max(15).optional(),
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
  clearCloudflareToken: z.boolean().optional(),
});
export type UpdateDnsSettingsInput = z.infer<typeof updateDnsSettingsSchema>;

// ---------------------------------------------------------------------------
// Application settings
// ---------------------------------------------------------------------------

/**
 * Settings that belong to the whole application rather than to one feature.
 *
 * Notifications live here rather than on the DNS settings row because what is
 * being configured is "how this dashboard reaches me", and the first feature to
 * send one will not be the last. The credential rule is the one used everywhere
 * else: omitted or blank keeps the stored value, and deleting is its own flag.
 */
export const updateAppSettingsSchema = z.object({
  dnsEnabled: z.boolean().optional(),
  modelRelayEnabled: z.boolean().optional(),
  gotifyAddress: z.string().max(500).optional(),
  gotifyToken: z.string().max(500).optional(),
  clearGotifyToken: z.boolean().optional(),
  notifyScriptResults: z.boolean().optional(),
  notifyDnsChanges: z.boolean().optional(),
});
export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;

/**
 * The test message is sent with the form's current values, so a credential can
 * be verified before it is saved. Only the two fields it uses are accepted.
 */
export const testNotificationSchema = updateAppSettingsSchema.pick({
  gotifyAddress: true,
  gotifyToken: true,
});
export type TestNotificationInput = z.infer<typeof testNotificationSchema>;

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
  interactive?: boolean;
  id: string;
  scheduleId: string | null;
  scheduleName: string | null;
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
  /**
   * Directory on the target the script ran in. The script file itself is staged
   * in a temporary directory, so relative paths inside the script resolve here.
   */
  workDir: string;
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
  /**
   * A staging directory could be created, written, read back and removed. This
   * is the whole remote surface a run adds, so it is worth proving before the
   * first one rather than discovering it then.
   */
  stagingOk: boolean;
};

export type TargetDirectoryEntry = {
  /** Last path segment, shown in the picker. */
  name: string;
  /** Absolute path on the target, used to descend or to select. */
  path: string;
};

/**
 * One level of a target's directory tree.
 *
 * `parent` is null at the filesystem root, so the picker knows "up" has nowhere
 * to go instead of guessing from the path.
 */
export type TargetDirectoryListing = {
  path: string;
  parent: string | null;
  entries: TargetDirectoryEntry[];
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
  ipv6Source: DnsIpv6Source;
  localIpv6Interface: string;
  scheduleEnabled: boolean;
  intervalMinutes: number;
  cloudflareZoneId: string;
  cloudflareRecordName: string;
  hasCloudflareToken: boolean;
  updatedAt: string;
};

/**
 * The application settings as the API returns them.
 *
 * Same rule as `DnsSettingsView`: no field here can carry a secret, so a route
 * cannot leak one by forgetting to strip it. `notificationsReady` is derived
 * rather than stored -- it is simply "both halves are present" -- so it cannot
 * disagree with the two fields beside it.
 */
export type AppSettingsView = {
  dnsEnabled: boolean;
  modelRelayEnabled: boolean;
  gotifyAddress: string;
  hasGotifyToken: boolean;
  notificationsReady: boolean;
  notifyScriptResults: boolean;
  notifyDnsChanges: boolean;
  updatedAt: string | null;
};

export type DnsRecord = {
  provider: DnsProviderName;
  /** The full DNS record name reported by Cloudflare. */
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
  /** Last completed scheduled check in this process; null until one finishes. */
  lastRunAt: string | null;
  lastOk: boolean | null;
  /** Null for success or an unexpected internal error, distinguished by lastOk. */
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
  };
};

export type DnsIpv6Probe = {
  ipv6: string;
  detectedAt: string;
};

/**
 * Whether the record and this host agree, as of the last time both were seen.
 *
 * `unknown` is a real answer rather than a gap to paper over. The two addresses
 * are held in memory and lost on restart, and a comparison nobody has performed
 * is not a comparison this console will invent -- a "consistent" that was never
 * checked is worse than an honest "not compared yet", because the whole point of
 * the console is being able to trust that word. A configured deployment
 * repopulates both on its next scheduled check.
 */
export type DnsConsistency = {
  /**
   * `moved` means the record points somewhere other than where this host is --
   * the state a check exists to correct, not a past tense.
   */
  state: 'consistent' | 'moved' | 'unknown';
  /** The address this host last detected; null when nothing has probed. */
  ipv6: string | null;
  /** What the provider last answered; null when nothing has queried. */
  recordValue: string | null;
  recordName: string | null;
  /** When the more recent of the two observations was made. */
  at: string | null;
};

export type DnsRecordProbe = {
  /** Null means the provider has no AAAA record yet, which is not an error. */
  record: DnsRecord | null;
  queriedAt: string;
};

/** The answer to a test message: it was handed to the notifier, and accepted. */
export type NotificationTest = {
  sent: true;
};

// ---------------------------------------------------------------------------
// Error contract
// ---------------------------------------------------------------------------

/**
 * A locale-neutral identity for a message the server produced.
 *
 * The server never renders prose for a client in a language it cannot know: it
 * names the message and supplies the values, and the client's own dictionary
 * chooses the words. `params` holds plain values, except where the value is
 * itself a name that has to be translated -- a credential field, an entity --
 * in which case it is an identifier the client looks up.
 */
export type ErrorI18n = {
  key: string;
  params?: Record<string, string | number | readonly string[]>;
};

/** The body of every failed API response. */
export type ApiErrorBody = {
  code: string;
  message: string;
  /** Present when `message` has a locale-neutral identity. */
  i18n?: ErrorI18n;
  details?: unknown;
};

// ---------------------------------------------------------------------------
// WebSocket protocol
// ---------------------------------------------------------------------------

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), executionId: z.string().min(1) }),
  z.object({ type: z.literal('unsubscribe'), executionId: z.string().min(1) }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('terminal_claim'), executionId: z.string().min(1) }),
  z.object({ type: z.literal('terminal_release'), executionId: z.string().min(1) }),
  z.object({ type: z.literal('terminal_input'), executionId: z.string().min(1),
    data: z.string().min(1).max(16384).refine((data) => [...data].reduce((bytes, char) => {
      const point = char.codePointAt(0)!;
      return bytes + (point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4);
    }, 0) <= 16384) }),
  z.object({ type: z.literal('terminal_resize'), executionId: z.string().min(1),
    cols: z.number().int().min(2).max(500), rows: z.number().int().min(2).max(500) }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type TerminalState = 'waiting' | 'available' | 'controlling' | 'busy' | 'closed';

export type ServerMessage =
  | { type: 'terminal_state'; executionId: string; state: TerminalState; error?: string }
  | { type: 'hello'; serverTime: string }
  | { type: 'subscribed'; executionId: string }
  | { type: 'log'; chunk: ExecutionLogChunk }
  | { type: 'status'; execution: ExecutionSummary }
  | { type: 'pong' }
  | { type: 'error'; message: string };
