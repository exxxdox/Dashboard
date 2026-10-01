/**
 * Runtime configuration, read once at boot and validated.
 *
 * Failing fast beats discovering a bad value at the first execution attempt, so
 * every variable is parsed here and the process exits with a readable list if
 * anything is unusable.
 */

import { join, resolve } from 'node:path';

import { z } from 'zod';

import { normalizePosix } from './lib/paths.js';

/**
 * `z.coerce.boolean()` would turn the string "false" into `true`, because
 * JavaScript's `Boolean("false")` is `true`. Parse the common spellings instead.
 */
const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined || value === '') return undefined;
    return !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  /** Bind address inside the container. */
  HOST: z.string().min(1).default('0.0.0.0'),

  /** SQLite database and generated secret key live here. */
  DATA_DIR: z.string().min(1).default('/data'),

  /**
   * Where the host's script directory is mounted inside the container. This is
   * only how scripts get *in* to be scanned and read; it has no relationship to
   * any path on a target, which is why nothing needs to match any more.
   */
  SCRIPT_ROOT_CONTAINER: z.string().min(1).default('/workspace'),

  /**
   * Directory on the *target host* that a run writes its staged script into,
   * and removes again afterwards. Must exist and be writable by the SSH user;
   * the target check proves that before the first run.
   */
  STAGING_DIR: z.string().min(1).default('/tmp'),

  /** 32 random bytes, base64. Generated into DATA_DIR when absent. */
  SECRET_KEY: z.string().optional(),

  /**
   * Sign-in credentials. Both or neither, checked below: a username without a
   * password is a login nobody can pass, a password without a username is one
   * anybody can. Unset means the dashboard runs open, which is what it did
   * before this existed -- and what local development and the tests still rely
   * on, so it warns at boot rather than refusing.
   */
  AUTH_USERNAME: z.string().min(1).max(200).optional(),
  AUTH_PASSWORD: z.string().min(1).max(1000).optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Pretty logs for a terminal. Development only: the production image installs
   * production dependencies, so `pino-pretty` -- a devDependency -- is not there
   * to load, and asking for it stops the process before it serves anything.
   * Production therefore ignores it, and `index.ts` says so out loud.
   */
  LOG_PRETTY: booleanFromEnv,

  /** Global ceiling on simultaneously running scripts. */
  MAX_CONCURRENT_EXECUTIONS: z.coerce.number().int().min(1).max(64).default(4),
  /** Per-host ceiling, so one busy target cannot consume every slot. */
  MAX_CONCURRENT_PER_TARGET: z.coerce.number().int().min(1).max(32).default(2),

  /** Applied when neither the script header nor the request specifies one. */
  DEFAULT_TIMEOUT_SEC: z.coerce.number().int().min(1).max(86_400).default(1800),

  /**
   * Captured output per execution. Output past this is dropped and the record is
   * flagged as truncated, rather than letting a runaway script fill the disk.
   */
  MAX_LOG_BYTES: z.coerce.number().int().min(4096).default(5 * 1024 * 1024),

  /** Completed executions (and their logs) older than this are pruned. 0 disables. */
  RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(30),

  /**
   * Proxy the git transport uses when cloning script repositories. Unset leaves
   * git to its own environment (`HTTPS_PROXY` and friends).
   *
   * Deliberately not validated as a URL: git accepts a bare `host:port` as well
   * as `scheme://host`, and curl -- not this parser -- is the authority on what
   * a proxy string may contain. Whitespace is the one thing that is always
   * wrong, and catching it here beats failing at the first sync.
   */
  GIT_PROXY: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = (value ?? '').trim();
      return trimmed === '' ? undefined : trimmed;
    })
    .refine((value) => value === undefined || !/\s/.test(value), {
      message: 'must not contain whitespace',
    }),

  /** Serve the built web client from the same origin. */
  SERVE_WEB: booleanFromEnv,
  WEB_DIST_DIR: z.string().min(1).default('/app/web'),
});

export type AppConfig = {
  port: number;
  host: string;
  dataDir: string;
  databaseFile: string;
  scriptRootContainer: string;
  stagingDir: string;
  secretKey: string | undefined;
  logLevel: string;
  logPretty: boolean;
  /** True when `LOG_PRETTY` was asked for in production and therefore dropped. */
  logPrettyIgnored: boolean;
  maxConcurrentExecutions: number;
  maxConcurrentPerTarget: number;
  defaultTimeoutSec: number;
  maxLogBytes: number;
  retentionDays: number;
  /** Proxy for the git transport, or undefined to let git decide. */
  gitProxy: string | undefined;
  serveWeb: boolean;
  webDistDir: string;
  /** Sign-in credentials, or undefined when the dashboard is open. */
  authUsername: string | undefined;
  authPassword: string | undefined;
};

/** Parse configuration from an environment bag. Throws on invalid values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const value = parsed.data;
  const isProduction = value.NODE_ENV === 'production';

  if ((value.AUTH_USERNAME === undefined) !== (value.AUTH_PASSWORD === undefined)) {
    throw new Error(
      'Invalid environment configuration:\n  AUTH_USERNAME and AUTH_PASSWORD must be set ' +
        'together: sign-in needs both, and one alone would be a lock with no key.',
    );
  }

  // Normalise with POSIX rules rather than `path.resolve`, because this value is
  // compared against paths on the SSH target. `path.resolve` would introduce
  // backslashes on a non-Linux host and silently break every mapping.
  //
  // A relative value is accepted because it does work, but it is only ever
  // correct for local development: this is the container's mount point, and in
  // a container that is always absolute. `index.ts` warns when it is not.
  const scriptRootContainer = normalizePosix(value.SCRIPT_ROOT_CONTAINER);

  // These two are used only with local filesystem calls, so resolving them
  // against the working directory is correct -- and required, since
  // @fastify/static rejects a relative root outright.
  const dataDir = resolve(value.DATA_DIR);

  return {
    port: value.PORT,
    host: value.HOST,
    dataDir,
    databaseFile: join(dataDir, 'dashboard.db'),
    scriptRootContainer,
    secretKey: value.SECRET_KEY,
    logLevel: value.LOG_LEVEL,
    // Pretty logs are for reading in a terminal; JSON is what a collector wants.
    // Production is not a terminal, and its image cannot load the transport at
    // all, so the flag is dropped there rather than obeyed -- refusing to start
    // over a cosmetic setting would be the worse failure. `logPrettyIgnored`
    // exists so the boot can say it was dropped instead of silently differing
    // from what .env asked for.
    logPretty: isProduction ? false : (value.LOG_PRETTY ?? true),
    logPrettyIgnored: isProduction && value.LOG_PRETTY === true,
    maxConcurrentExecutions: value.MAX_CONCURRENT_EXECUTIONS,
    maxConcurrentPerTarget: value.MAX_CONCURRENT_PER_TARGET,
    defaultTimeoutSec: value.DEFAULT_TIMEOUT_SEC,
    maxLogBytes: value.MAX_LOG_BYTES,
    retentionDays: value.RETENTION_DAYS,
    gitProxy: value.GIT_PROXY,
    authUsername: value.AUTH_USERNAME,
    authPassword: value.AUTH_PASSWORD,
    serveWeb: value.SERVE_WEB ?? true,
    webDistDir: resolve(value.WEB_DIST_DIR),
    stagingDir: normalizePosix(value.STAGING_DIR),
  };
}
