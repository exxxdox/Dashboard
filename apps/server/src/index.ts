/**
 * Process entry point: assemble the object graph, start serving, shut down
 * cleanly.
 *
 * Everything is constructed here and injected downwards, so there is exactly one
 * place that decides how a database, an encryption key, and a queue are built --
 * and exactly one place a test has to replace to run the whole thing on fakes.
 */

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase } from './db/client.js';
import { createAuthenticator, createLoginThrottle } from './lib/auth.js';
import { installCrashHandlers } from './lib/crash-handlers.js';
import { createSecretBox, resolveSecretKey } from './lib/crypto.js';
import { createLogger } from './lib/logger.js';
import { createQueue } from './runner/queue.js';
import { createExecutionRunner } from './runner/runner.js';
import { createDnsScheduler } from './services/dns/scheduler.js';
import { createDnsService, type DnsService } from './services/dns/service.js';
import { resolveSettings } from './services/dns/settings.js';
import { createExecutionService, type ExecutionService } from './services/executions.js';
import { createNotificationService } from './services/notifications/service.js';
import { createExecutionHub } from './ws/hub.js';

/** How often retention runs. Daily is plenty for a self-hosted dashboard. */
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** How long running scripts are given to finish after a shutdown signal. */
const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, pretty: config.logPretty });

  if (config.logPrettyIgnored) {
    logger.warn(
      'LOG_PRETTY is ignored outside development: the image installs production dependencies only, ' +
        'so pino-pretty is not there to load and obeying the flag would stop the process at startup',
    );
  }

  if (!config.scriptRootContainer.startsWith('/')) {
    logger.warn(
      { scriptRootContainer: config.scriptRootContainer },
      'SCRIPT_ROOT_CONTAINER is not absolute. That is only correct for local development; ' +
        'in a container it is the mount point and must be an absolute path such as /workspace.',
    );
  }

  const keyResolution = resolveSecretKey(config.dataDir, config.secretKey);
  if (keyResolution.source === 'generated') {
    logger.warn(
      { path: keyResolution.path },
      'generated a new encryption key; back it up alongside the database or stored credentials become unrecoverable',
    );
  }

  const db = openDatabase(config.databaseFile);
  const box = createSecretBox(keyResolution.key);
  const hub = createExecutionHub();

  const auth = createAuthenticator({
    username: config.authUsername,
    password: config.authPassword,
  });
  if (!auth.enabled) {
    // Not fatal: local development and the container's first run both start
    // without credentials, and refusing would be a worse default than saying so.
    logger.warn(
      'AUTH_USERNAME and AUTH_PASSWORD are not set: the dashboard is open to anyone who can reach it',
    );
  }

  let shuttingDown = false;

  const queue = createQueue({
    concurrency: config.maxConcurrentExecutions,
    perKeyConcurrency: config.maxConcurrentPerTarget,
    onEvent: (event) => {
      if (event.type === 'settled' && event.outcome === 'failed') {
        logger.warn({ executionId: event.id }, 'execution task failed outside the runner');
      }
    },
  });

  // The runner publishes updated rows and the execution service owns the
  // queries, so the two reference each other. Resolving it lazily through this
  // closure avoids a module cycle while keeping both dependencies explicit.
  let executions!: ExecutionService;

  const runner = createExecutionRunner({
    db,
    hub,
    logger,
    maxLogBytes: config.maxLogBytes,
    loadSummary: (executionId) => executions.get(executionId),
  });

  executions = createExecutionService({ db, box, config, hub, logger, runner, queue });

  // Built before the DNS service, which is only its first caller: the
  // notification credential is a dashboard setting, so it is owned here.
  const notifications = createNotificationService({ db, box });

  // The same cycle as the runner and the execution service, broken the same way:
  // the scheduler needs something to run, and the service reads the scheduler's
  // snapshot for its state payload.
  let dns!: DnsService;
  const dnsScheduler = createDnsScheduler({
    service: { update: (source, signal) => dns.update(source, signal) },
    logger,
  });
  dns = createDnsService({
    db,
    box,
    logger,
    sendNotification: (notification, signal) => notifications.send(notification, signal),
    getSchedule: () => dnsScheduler.snapshot(),
    configureSchedule: (settings) => {
      dnsScheduler.configure(settings);
    },
  });

  const ctx: AppContext = {
    config,
    db,
    box,
    logger,
    hub,
    queue,
    runner,
    executions,
    dns,
    dnsScheduler,
    notifications,
    auth,
    loginThrottle: createLoginThrottle(),
    isShuttingDown: () => shuttingDown,
  };

  // Anything the previous process left mid-flight is not running any more, and
  // reporting otherwise would strand the UI on a run that will never finish.
  executions.markInterrupted();
  executions.prune();

  // Restore the schedule a previous process left enabled. A failure here must not
  // stop the server starting: whatever cannot be read is the same thing the DNS
  // page will report when someone opens it, and a process that refuses to boot
  // is a worse answer than one that explains itself in the UI.
  try {
    const stored = resolveSettings(db, box);
    if (stored) {
      dnsScheduler.configure({
        scheduleEnabled: stored.scheduleEnabled,
        intervalMinutes: stored.intervalMinutes,
      });
    }
  } catch (error) {
    logger.warn({ err: error }, 'the stored DNS settings could not be read at boot');
  }

  const pruneTimer = setInterval(() => {
    try {
      executions.prune();
    } catch (error) {
      logger.warn({ err: error }, 'retention prune failed');
    }
  }, PRUNE_INTERVAL_MS);
  // Do not hold the process open purely for the timer.
  pruneTimer.unref();

  const app = await buildApp(ctx);

  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    // A second signal, or a crash during a shutdown already in progress, is a
    // request for this process to be gone -- waiting through the grace period
    // again would help nobody.
    if (shuttingDown) process.exit(exitCode);
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    clearInterval(pruneTimer);
    // Stopped before the database closes: a tick that fired now would run
    // against a closed handle.
    dnsScheduler.stop();

    // Stop accepting work first, then give the queue a bounded window to finish.
    // Runs that do not finish are reported as interrupted on the next boot.
    try {
      await app.close();
    } catch (error) {
      logger.warn({ err: error }, 'error while closing the HTTP server');
    }

    const deadline = Date.now() + SHUTDOWN_GRACE_MS;
    while ((queue.activeCount > 0 || queue.pendingCount > 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    db.close();
    logger.info('shutdown complete');
    // The exit code is the caller's: a signal is a clean stop, a crash is not,
    // and `restart: unless-stopped` plus any supervision reads the difference.
    process.exit(exitCode);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  installCrashHandlers({ logger, shutdown });

  await app.listen({ port: config.port, host: config.host });

  logger.info(
    {
      port: config.port,
      dataDir: config.dataDir,
      scriptRoot: config.scriptRootContainer,
      keySource: keyResolution.source,
      maxConcurrentExecutions: config.maxConcurrentExecutions,
    },
    'dashboard ready',
  );
}

main().catch((error: unknown) => {
  // At this point no logger is guaranteed to exist, so go to stderr directly.
  console.error('Failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
