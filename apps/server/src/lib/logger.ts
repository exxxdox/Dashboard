import pino, { type Logger } from 'pino';

export type { Logger };

/**
 * Build the application logger.
 *
 * Pretty output is a development convenience only; in production the default
 * JSON lines are what a log collector expects. It is also the only form the
 * image can produce, because `pino-pretty` is a devDependency and the image
 * installs production dependencies -- which is why `loadConfig` drops the flag
 * outside development instead of letting this function throw on a transport
 * target that cannot be resolved.
 */
export function createLogger(options: { level: string; pretty: boolean }): Logger {
  if (!options.pretty) {
    return pino({ level: options.level });
  }

  return pino({
    level: options.level,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    },
  });
}
