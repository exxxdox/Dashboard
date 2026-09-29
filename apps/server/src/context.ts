/**
 * The object graph every route handler receives.
 *
 * Built once at boot and passed down rather than imported as module state, so
 * tests can assemble a context with a fake transport and an in-memory database
 * without touching the real one.
 */

import type { AppConfig } from './config.js';
import type { Db } from './db/client.js';
import type { Authenticator, LoginThrottle } from './lib/auth.js';
import type { SecretBox } from './lib/crypto.js';
import type { Logger } from './lib/logger.js';
import type { Queue } from './runner/queue.js';
import type { ExecutionRunner } from './runner/runner.js';
import type { ExecutionService } from './services/executions.js';
import type { ExecutionHub } from './ws/hub.js';

export type AppContext = {
  config: AppConfig;
  db: Db;
  /**
   * Sign-in. Both objects are constructed at the composition root rather than
   * imported as module state, so a test can hand the app an authenticator with
   * known credentials -- or one with none, which is the default.
   */
  auth: Authenticator;
  loginThrottle: LoginThrottle;
  box: SecretBox;
  logger: Logger;
  hub: ExecutionHub;
  queue: Queue;
  runner: ExecutionRunner;
  executions: ExecutionService;
  /** Set while the process is shutting down, so routes can refuse new work. */
  isShuttingDown: () => boolean;
};
