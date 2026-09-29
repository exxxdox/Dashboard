import { describe, expect, test } from 'vitest';

import { loadConfig } from './config.js';

describe('GIT_PROXY', () => {
  test('is unset when the variable is absent', () => {
    expect(loadConfig({}).gitProxy).toBeUndefined();
  });

  test('treats an empty or blank value as unset, so .env can leave it off', () => {
    expect(loadConfig({ GIT_PROXY: '' }).gitProxy).toBeUndefined();
    expect(loadConfig({ GIT_PROXY: '   ' }).gitProxy).toBeUndefined();
  });

  test('keeps a URL proxy verbatim', () => {
    expect(loadConfig({ GIT_PROXY: 'http://127.0.0.1:7890' }).gitProxy).toBe(
      'http://127.0.0.1:7890',
    );
  });

  test('accepts the host:port form and a socks proxy', () => {
    expect(loadConfig({ GIT_PROXY: '127.0.0.1:7890' }).gitProxy).toBe('127.0.0.1:7890');
    expect(loadConfig({ GIT_PROXY: 'socks5h://127.0.0.1:1080' }).gitProxy).toBe(
      'socks5h://127.0.0.1:1080',
    );
  });

  test('rejects a value containing whitespace rather than letting git fail at the first sync', () => {
    expect(() => loadConfig({ GIT_PROXY: 'http://one two:7890' })).toThrow(/GIT_PROXY/);
  });
});

describe('LOG_PRETTY', () => {
  test('is on by default in development, where a terminal is reading it', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    expect(config.logPretty).toBe(true);
    expect(config.logPrettyIgnored).toBe(false);
  });

  test('is off by default in production, where JSON lines are what a collector wants', () => {
    const config = loadConfig({ NODE_ENV: 'production' });
    expect(config.logPretty).toBe(false);
    expect(config.logPrettyIgnored).toBe(false);
  });

  test('is honoured in development even when asked for explicitly', () => {
    const config = loadConfig({ NODE_ENV: 'development', LOG_PRETTY: 'true' });
    expect(config.logPretty).toBe(true);
    expect(config.logPrettyIgnored).toBe(false);
  });

  test('is ignored in production, because the image ships no pino-pretty to load', () => {
    const config = loadConfig({ NODE_ENV: 'production', LOG_PRETTY: 'true' });
    expect(config.logPretty).toBe(false);
    expect(config.logPrettyIgnored).toBe(true);
  });

  test('is ignored in production whichever spelling of true is used', () => {
    expect(loadConfig({ NODE_ENV: 'production', LOG_PRETTY: '1' }).logPrettyIgnored).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', LOG_PRETTY: 'yes' }).logPrettyIgnored).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', LOG_PRETTY: 'false' }).logPrettyIgnored).toBe(false);
  });
});

describe('sign-in credentials', () => {
  const base = { SCRIPT_ROOT_CONTAINER: '/workspace' } as NodeJS.ProcessEnv;

  test('are off when neither is set, which is the default', () => {
    const config = loadConfig(base);
    expect(config.authUsername).toBeUndefined();
    expect(config.authPassword).toBeUndefined();
  });

  test('are read when both are set', () => {
    const config = loadConfig({ ...base, AUTH_USERNAME: 'ops', AUTH_PASSWORD: 'secret' });
    expect(config.authUsername).toBe('ops');
    expect(config.authPassword).toBe('secret');
  });

  test('refuse a username with no password, rather than starting a lock with no key', () => {
    expect(() => loadConfig({ ...base, AUTH_USERNAME: 'ops' })).toThrow(/set together/);
  });

  test('refuse a password with no username, which would let anyone in', () => {
    expect(() => loadConfig({ ...base, AUTH_PASSWORD: 'secret' })).toThrow(/set together/);
  });
});
