import { describe, expect, test } from 'vitest';

import {
  executeScriptSchema,
  loginSchema,
  runDraftSchema,
  testDnsNotificationSchema,
  updateDnsSettingsSchema,
  updateSourceSchema,
} from './schemas.js';

describe('executeScriptSchema', () => {
  test('defaults the positional arguments to none', () => {
    expect(executeScriptSchema.parse({ targetId: 'tg-1' })).toEqual({
      targetId: 'tg-1',
      params: {},
      argv: [],
    });
  });

  test('keeps positional arguments in order and unmodified', () => {
    const input = executeScriptSchema.parse({
      targetId: 'tg-1',
      argv: ['100', 'two words', ''],
    });
    expect(input.argv).toEqual(['100', 'two words', '']);
  });

  test('rejects an argument longer than the cap', () => {
    expect(
      executeScriptSchema.safeParse({ targetId: 'tg-1', argv: ['x'.repeat(8193)] }).success,
    ).toBe(false);
  });

  test('rejects more arguments than a run may carry', () => {
    const argv = Array.from({ length: 51 }, (_, index) => String(index));
    expect(executeScriptSchema.safeParse({ targetId: 'tg-1', argv }).success).toBe(false);
  });
});

describe('updateSourceSchema', () => {
  test('accepts a partial edit', () => {
    expect(updateSourceSchema.parse({ name: 'ops' })).toEqual({ name: 'ops' });
    expect(updateSourceSchema.parse({ branch: 'release' })).toEqual({ branch: 'release' });
  });

  test('accepts an empty edit, which changes nothing', () => {
    expect(updateSourceSchema.parse({})).toEqual({});
  });

  test('accepts null for branch, so an edit can go back to the default branch', () => {
    expect(updateSourceSchema.parse({ branch: null })).toEqual({ branch: null });
  });

  test('drops kind, which is not editable', () => {
    expect(updateSourceSchema.parse({ kind: 'local', name: 'ops' })).toEqual({ name: 'ops' });
  });

  test('rejects an empty name rather than writing a nameless source', () => {
    expect(updateSourceSchema.safeParse({ name: '' }).success).toBe(false);
  });

  test('rejects a name longer than the create schema allows', () => {
    expect(updateSourceSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
  });
});

describe('runDraftSchema', () => {
  test('accepts an empty draft, which is what a never-touched form is', () => {
    expect(runDraftSchema.parse({})).toEqual({ params: {}, custom: [], timeoutSec: '' });
  });

  test('keeps a half-typed row: a draft is not validated as if it were a run', () => {
    const draft = runDraftSchema.parse({
      custom: [
        { name: '', value: 'orphan', mode: 'env' },
        { name: '起始端口', value: '', mode: 'argv' },
      ],
    });
    expect(draft.custom).toEqual([
      { name: '', value: 'orphan', mode: 'env' },
      { name: '起始端口', value: '', mode: 'argv' },
    ]);
  });

  test('rejects a mode that is neither channel', () => {
    expect(
      runDraftSchema.safeParse({ custom: [{ name: 'A', value: '1', mode: 'stdin' }] }).success,
    ).toBe(false);
  });

  test('rejects more rows than a run could carry', () => {
    const custom = Array.from({ length: 51 }, () => ({ name: 'A', value: '1', mode: 'env' }));
    expect(runDraftSchema.safeParse({ custom }).success).toBe(false);
  });

  test('bounds the parameter map, which is what a hand-crafted draft would blow up', () => {
    // Without this the only limit is the request body cap, and the form turns
    // every stray key into a row when it restores.
    const params = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [`EXTRA_${index}`, 'x']),
    );
    expect(runDraftSchema.safeParse({ params }).success).toBe(false);
  });

  test('rejects a parameter name longer than an environment variable may be', () => {
    expect(runDraftSchema.safeParse({ params: { ['X'.repeat(65)]: 'x' } }).success).toBe(false);
  });

  test('rejects a parameter value longer than an argument may be', () => {
    expect(runDraftSchema.safeParse({ params: { A: 'x'.repeat(8193) } }).success).toBe(false);
  });

  test('rejects a value longer than an argument may be', () => {
    const custom = [{ name: 'A', value: 'x'.repeat(8193), mode: 'argv' }];
    expect(runDraftSchema.safeParse({ custom }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  test('accepts a username and password', () => {
    expect(loginSchema.parse({ username: 'ops', password: 'hunter2' })).toEqual({
      username: 'ops',
      password: 'hunter2',
    });
  });

  test('rejects either half being empty', () => {
    expect(loginSchema.safeParse({ username: '', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ username: 'ops', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ username: 'ops' }).success).toBe(false);
  });

  test('bounds the body a login may carry', () => {
    expect(loginSchema.safeParse({ username: 'x'.repeat(201), password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ username: 'ops', password: 'x'.repeat(1001) }).success).toBe(
      false,
    );
  });
});

describe('updateDnsSettingsSchema', () => {
  test('accepts an empty body, because every field means "leave this alone"', () => {
    expect(updateDnsSettingsSchema.parse({})).toEqual({});
  });

  test('takes a blank secret as "keep the stored one"', () => {
    // The API never returns a credential, so a form cannot round-trip one: it
    // either sends a new value or sends nothing.
    const parsed = updateDnsSettingsSchema.parse({ cloudflareToken: '', gotifyToken: '' });
    expect(parsed.cloudflareToken).toBe('');
    expect(updateDnsSettingsSchema.parse({}).cloudflareToken).toBeUndefined();
  });

  test('bounds the interval at both ends', () => {
    expect(updateDnsSettingsSchema.safeParse({ intervalMinutes: 1 }).success).toBe(true);
    expect(updateDnsSettingsSchema.safeParse({ intervalMinutes: 10_080 }).success).toBe(true);
    expect(updateDnsSettingsSchema.safeParse({ intervalMinutes: 0 }).success).toBe(false);
    expect(updateDnsSettingsSchema.safeParse({ intervalMinutes: 10_081 }).success).toBe(false);
    // The form sends a number; a string is a bug in the caller, not a value to
    // coerce, because the interval is one of the few fields with real bounds.
    expect(updateDnsSettingsSchema.safeParse({ intervalMinutes: '10' }).success).toBe(false);
  });

  test('restricts the provider to the two implementations that exist', () => {
    expect(updateDnsSettingsSchema.safeParse({ provider: 'cloudflare' }).success).toBe(true);
    expect(updateDnsSettingsSchema.safeParse({ provider: 'alibaba' }).success).toBe(true);
    expect(updateDnsSettingsSchema.safeParse({ provider: 'route53' }).success).toBe(false);
  });

  test('carries the clear flags as their own fields', () => {
    const parsed = updateDnsSettingsSchema.parse({
      clearCloudflareToken: true,
      clearGotifyToken: false,
    });
    expect(parsed.clearCloudflareToken).toBe(true);
    // False is not the same as absent: absent leaves the decision to the
    // service, false is an explicit "do not clear".
    expect(parsed.clearGotifyToken).toBe(false);
    expect(parsed.clearAlibabaAccessKeySecret).toBeUndefined();
  });
});

describe('testDnsNotificationSchema', () => {
  test('accepts only the two fields a test message can use', () => {
    const parsed = testDnsNotificationSchema.parse({
      gotifyAddress: 'notify.test',
      gotifyToken: 'token',
      cloudflareZoneId: 'ignored',
    });
    expect(parsed).toEqual({ gotifyAddress: 'notify.test', gotifyToken: 'token' });
  });
});
