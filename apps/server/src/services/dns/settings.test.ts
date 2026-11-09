import { randomBytes } from 'node:crypto';
import { MIN_DNS_INTERVAL_MINUTES } from '@dashboard/shared';
import { describe, expect, test } from 'vitest';

import { openDatabase, type Db } from '../../db/client.js';
import { createSecretBox, type SecretBox } from '../../lib/crypto.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';
import {
  getSettingsView,
  readSettingsRow,
  resolveSettings,
  saveSettings,
  validate,
} from './settings.js';

const FULL_CLOUDFLARE = {
  provider: 'cloudflare' as const,
  cloudflareToken: 'cf-token',
  cloudflareZoneId: 'zone-1',
  cloudflareRecordName: 'home.example.com',
};

function setup(): { db: Db; box: SecretBox } {
  return { db: openDatabase(':memory:'), box: createSecretBox(randomBytes(32)) };
}

describe('reading settings that were never saved', () => {
  test('reports nothing and writes nothing', () => {
    const { db, box } = setup();
    try {
      // A GET must not create the row: "never configured" and "configured and
      // empty" are different states, and a read that writes is how they collapse.
      expect(getSettingsView(db)).toBeNull();
      expect(resolveSettings(db, box)).toBeNull();
      expect(readSettingsRow(db)).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe('saving settings', () => {
  test('defaults to ipify and preserves a saved local source across partial updates', () => {
    const { db, box } = setup();
    try {
      expect(saveSettings(db, box, FULL_CLOUDFLARE).ipv6Source).toBe('ipify');
      expect(saveSettings(db, box, { ipv6Source: 'local' }).ipv6Source).toBe('local');
      expect(readSettingsRow(db)?.ipv6_source).toBe('local');
      expect(resolveSettings(db, box)?.ipv6Source).toBe('local');
      saveSettings(db, box, { intervalMinutes: 20 });
      expect(getSettingsView(db)?.ipv6Source).toBe('local');
      expect(resolveSettings(db, box)?.cloudflareToken).toBe('cf-token');
    } finally {
      db.close();
    }
  });

  test('stores the credentials encrypted and returns none of them', () => {
    const { db, box } = setup();
    try {
      const view = saveSettings(db, box, FULL_CLOUDFLARE);

      const row = readSettingsRow(db);
      expect(row?.cloudflare_token_encrypted).not.toBeNull();
      expect(row?.cloudflare_token_encrypted).not.toContain('cf-token');

      expect(view).toMatchObject({
        provider: 'cloudflare',
        cloudflareZoneId: 'zone-1',
        cloudflareRecordName: 'home.example.com',
        hasCloudflareToken: true,
      });
      // The discipline is structural rather than remembered: there is no key a
      // credential could be hiding under.
      expect(Object.keys(view).sort()).toEqual([
        'provider', 'ipv6Source', 'localIpv6Interface', 'scheduleEnabled',
        'intervalMinutes', 'cloudflareZoneId', 'cloudflareRecordName',
        'hasCloudflareToken', 'updatedAt',
      ].sort());
      expect(Object.keys(view)).not.toContain('cloudflareToken');
    } finally {
      db.close();
    }
  });

  test('stores the local interface, keeps it on partial updates and allows clearing it', () => {
    const { db, box } = setup();
    try {
      expect(saveSettings(db, box, FULL_CLOUDFLARE).localIpv6Interface).toBe('');
      expect(saveSettings(db, box, {
        ipv6Source: 'local', localIpv6Interface: ' enp1s0 ',
      }).localIpv6Interface).toBe('enp1s0');
      expect(readSettingsRow(db)?.local_ipv6_interface).toBe('enp1s0');
      expect(resolveSettings(db, box)?.localIpv6Interface).toBe('enp1s0');
      saveSettings(db, box, { intervalMinutes: 15 });
      expect(getSettingsView(db)?.localIpv6Interface).toBe('enp1s0');
      expect(saveSettings(db, box, { localIpv6Interface: '' }).localIpv6Interface).toBe('');
      expect(resolveSettings(db, box)?.localIpv6Interface).toBe('');
    } finally {
      db.close();
    }
  });

  test('keeps the stored credential when the field is blank or absent', () => {
    const { db, box } = setup();
    try {
      saveSettings(db, box, FULL_CLOUDFLARE);

      saveSettings(db, box, { cloudflareToken: '' });
      expect(box.decrypt(readSettingsRow(db)?.cloudflare_token_encrypted ?? '')).toBe('cf-token');

      saveSettings(db, box, { cloudflareRecordName: 'other.example.com' });
      const afterAbsent = readSettingsRow(db);
      expect(box.decrypt(afterAbsent?.cloudflare_token_encrypted ?? '')).toBe('cf-token');
      expect(afterAbsent?.cloudflare_record_name).toBe('other.example.com');
    } finally {
      db.close();
    }
  });

  test('replaces a credential only when a new value is sent', () => {
    const { db, box } = setup();
    try {
      saveSettings(db, box, FULL_CLOUDFLARE);
      saveSettings(db, box, { cloudflareToken: 'cf-token-2' });

      expect(box.decrypt(readSettingsRow(db)?.cloudflare_token_encrypted ?? '')).toBe('cf-token-2');
    } finally {
      db.close();
    }
  });

  test('refuses to clear the active provider credential and leaves the row untouched', () => {
    const { db, box } = setup();
    try {
      saveSettings(db, box, FULL_CLOUDFLARE);
      const before = readSettingsRow(db);

      // The clear flag is the explicit way to delete, so it has to be refused
      // here by the same rule that requires the field -- with the field named.
      expect(() => saveSettings(db, box, { clearCloudflareToken: true })).toThrow(ValidationError);
      expect(() => saveSettings(db, box, { clearCloudflareToken: true })).toThrow(
        /Cloudflare API token/,
      );

      expect(readSettingsRow(db)).toEqual(before);
    } finally {
      db.close();
    }
  });

  test('refuses a save that would leave the selected provider without its fields', () => {
    const { db, box } = setup();
    try {
      expect(() => saveSettings(db, box, { intervalMinutes: 5 })).toThrow(/Cloudflare API token/);
      expect(getSettingsView(db)).toBeNull();
    } finally {
      db.close();
    }
  });

  test('names the credential that no longer decrypts', () => {
    const { db, box } = setup();
    try {
      saveSettings(db, box, FULL_CLOUDFLARE);
      const other = createSecretBox(randomBytes(32));

      expect(() => resolveSettings(db, other)).toThrow(ConflictError);
      expect(() => resolveSettings(db, other)).toThrow(/secret key has changed/);
    } finally {
      db.close();
    }
  });
});

describe('validate', () => {
  test('accepts complete Cloudflare settings', () => {
    expect(validate({ ...FULL_CLOUDFLARE, intervalMinutes: 10 })).toBeNull();
  });

  test('lists everything missing at once, in both the forms it has to take', () => {
    const problem = validate({
      provider: 'cloudflare',
      intervalMinutes: 10,
      cloudflareToken: '',
      cloudflareZoneId: '',
      cloudflareRecordName: '',
    });

    expect(problem?.message).toMatch(
      /Cloudflare API token, Cloudflare zone id, Cloudflare record name/,
    );
    // The client is sent identifiers, not the English labels: it names the
    // fields itself, and a label would be untranslatable once it arrived.
    expect(problem?.i18n).toEqual({
      key: 'error.dns.missingCredentials',
      params: {
        provider: 'cloudflare',
        fields: ['cloudflareToken', 'cloudflareZoneId', 'cloudflareRecordName'],
      },
    });
  });

  test('names the interval bound as a number the client can read back', () => {
    const tooSmall = validate({
      provider: 'cloudflare',
      intervalMinutes: 0,
      cloudflareToken: 'cf-token',
      cloudflareZoneId: 'zone-1',
      cloudflareRecordName: 'home.example.com',
    });

    expect(tooSmall?.i18n).toEqual({
      key: 'error.dns.intervalTooSmall',
      params: { min: MIN_DNS_INTERVAL_MINUTES },
    });
  });
});
