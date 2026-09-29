import pino, { type Logger } from 'pino';

export type { Logger };

/**
 * Build the application logger.
 *
 * Pretty output is a development convenience only; in production the default
 * JSON lines are what a log collector expects, so `pino-pretty` is never loaded
 * unless it is actually asked for.
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
