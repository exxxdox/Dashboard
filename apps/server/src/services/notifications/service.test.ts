import { randomBytes } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';

import { openDatabase, type Db } from '../../db/client.js';
import { createSecretBox, type SecretBox } from '../../lib/crypto.js';
import { UpstreamError } from '../../lib/errors.js';
import { createNotificationService, type NotificationService } from './service.js';

type Harness = {
  db: Db;
  box: SecretBox;
  service: NotificationService;
  notify: ReturnType<typeof vi.fn>;
};

function setup(): Harness {
  const db = openDatabase(':memory:');
  const box = createSecretBox(randomBytes(32));
  const notify = vi.fn(async (): Promise<boolean> => true);

  return {
    db,
    box,
    notify,
    service: createNotificationService({
      db,
      box,
      notify: notify as unknown as (message: unknown) => Promise<boolean>,
    }),
  };
}

describe('settings', () => {
  test('reports an install that has never saved anything', () => {
    const h = setup();
    try {
      // Never null, unlike the DNS settings: the settings page always renders a
      // form, so `updatedAt` is what says nothing has been saved yet.
      expect(h.service.state()).toEqual({
        gotifyAddress: '',
        hasGotifyToken: false,
        notificationsReady: false,
        notifyScriptResults: true,
        notifyDnsChanges: true,
        updatedAt: null,
      });
    } finally {
      h.db.close();
    }
  });

  test('reports ready only once both halves of the credential are present', () => {
    const h = setup();
    try {
      const addressOnly = h.service.saveSettings({ gotifyAddress: 'notify.test' });
      expect(addressOnly).toMatchObject({ hasGotifyToken: false, notificationsReady: false });

      const both = h.service.saveSettings({ gotifyToken: 'secret' });
      expect(both).toMatchObject({
        gotifyAddress: 'notify.test',
        hasGotifyToken: true,
        notificationsReady: true,
      });
      expect(both.updatedAt).not.toBeNull();
    } finally {
      h.db.close();
    }
  });

  test('never returns the token, only whether one is stored', () => {
    const h = setup();
    try {
      h.service.saveSettings({ gotifyAddress: 'notify.test', gotifyToken: 'secret' });

      // The whole point of the view type: there is no field a secret could
      // travel in, so a route cannot leak one by forgetting to strip it.
      expect(JSON.stringify(h.service.state())).not.toContain('secret');
    } finally {
      h.db.close();
    }
  });

  test('treats a blank token as "keep", not "erase"', () => {
    const h = setup();
    try {
      h.service.saveSettings({ gotifyAddress: 'notify.test', gotifyToken: 'secret' });
      const after = h.service.saveSettings({ gotifyAddress: 'other.test', gotifyToken: '' });

      expect(after).toMatchObject({ gotifyAddress: 'other.test', hasGotifyToken: true });
    } finally {
      h.db.close();
    }
  });

  test('deletes a token only when the clear flag asks for it', () => {
    const h = setup();
    try {
      h.service.saveSettings({ gotifyAddress: 'notify.test', gotifyToken: 'secret' });
      const after = h.service.saveSettings({ clearGotifyToken: true });

      expect(after).toMatchObject({ hasGotifyToken: false, notificationsReady: false });
    } finally {
      h.db.close();
    }
  });
});

describe('send', () => {
  test('skips without calling the notifier when nothing is configured', async () => {
    const h = setup();
    try {
      expect(await h.service.send({ kind: 'script_result', title: 't', message: 'm' })).toBe(false);
      expect(h.notify).not.toHaveBeenCalled();
    } finally {
      h.db.close();
    }
  });

  test('sends with the stored credential', async () => {
    const h = setup();
    try {
      h.service.saveSettings({ gotifyAddress: 'notify.test', gotifyToken: 'secret' });

      expect(await h.service.send({ kind: 'script_result', title: 'A run finished', message: 'exit 0' })).toBe(true);
      expect(h.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          address: 'notify.test',
          token: 'secret',
          title: 'A run finished',
          message: 'exit 0',
        }),
      );
    } finally {
      h.db.close();
    }
  });

  test('lets a rejected send throw, so the caller decides what it means', async () => {
    const h = setup();
    try {
      h.service.saveSettings({ gotifyAddress: 'notify.test', gotifyToken: 'secret' });
      h.notify.mockRejectedValue(new Error('Gotify answered 500'));

      await expect(h.service.send({ kind: 'script_result', title: 't', message: 'm' })).rejects.toThrow(
        'Gotify answered 500',
      );
    } finally {
      h.db.close();
    }
  });
});

describe('test', () => {
  test('prefers the form value over the stored one without saving it', async () => {
    const h = setup();
    try {
      h.service.saveSettings({ gotifyAddress: 'stored.test', gotifyToken: 'stored' });

      await h.service.test({ gotifyAddress: 'typed.test', gotifyToken: 'typed' });

      expect(h.notify).toHaveBeenCalledWith(
        expect.objectContaining({ address: 'typed.test', token: 'typed' }),
      );
      // Trying a credential must not store it: the save button is the only
      // thing that writes.
      expect(h.service.state().gotifyAddress).toBe('stored.test');
    } finally {
      h.db.close();
    }
  });

  test('falls back to the stored credential when the form leaves it blank', async () => {
    const h = setup();
    try {
      h.service.saveSettings({ gotifyAddress: 'stored.test', gotifyToken: 'stored' });

      await h.service.test({ gotifyToken: '' });

      expect(h.notify).toHaveBeenCalledWith(
        expect.objectContaining({ address: 'stored.test', token: 'stored' }),
      );
    } finally {
      h.db.close();
    }
  });

  test('refuses when there is nothing to send with', async () => {
    const h = setup();
    try {
      await expect(h.service.test({})).rejects.toThrow(/Gotify address and token/);
      expect(h.notify).not.toHaveBeenCalled();
    } finally {
      h.db.close();
    }
  });

  test('carries a translation key for the refusal', async () => {
    const h = setup();
    try {
      await expect(h.service.test({})).rejects.toMatchObject({
        i18n: { key: 'error.notification.notConfigured' },
      });
    } finally {
      h.db.close();
    }
  });

  test('reports a failed send as an upstream problem, with the token redacted', async () => {
    const h = setup();
    try {
      h.notify.mockRejectedValue(new Error('POST /message?token=secret answered 401'));

      const attempt = h.service.test({ gotifyAddress: 'notify.test', gotifyToken: 'secret' });
      await expect(attempt).rejects.toThrow(UpstreamError);

      try {
        await h.service.test({ gotifyAddress: 'notify.test', gotifyToken: 'secret' });
      } catch (error) {
        expect((error as Error).message).toContain('token=***');
        expect((error as Error).message).not.toContain('token=secret');
      }
    } finally {
      h.db.close();
    }
  });
});


describe('notification preferences', () => {
  test('defaults both event types on and preserves preferences across partial updates', () => {
    const h = setup();
    try {
      expect(h.service.state()).toMatchObject({ notifyScriptResults: true, notifyDnsChanges: true });
      expect(h.service.saveSettings({ notifyScriptResults: false })).toMatchObject({ notifyScriptResults: false, notifyDnsChanges: true });
      expect(h.service.saveSettings({ gotifyAddress: 'notify.test', notifyDnsChanges: false })).toMatchObject({ notifyScriptResults: false, notifyDnsChanges: false });
      expect(h.service.saveSettings({ notifyScriptResults: true })).toMatchObject({ notifyScriptResults: true, notifyDnsChanges: false });
    } finally { h.db.close(); }
  });

  test.each([
    { kind: 'script_result' as const, preference: 'notifyScriptResults' as const, other: 'dns_change' as const },
    { kind: 'dns_change' as const, preference: 'notifyDnsChanges' as const, other: 'script_result' as const },
  ])('only suppresses the disabled $kind event', async ({ kind, preference, other }) => {
    const h = setup();
    try {
      h.service.saveSettings({ gotifyAddress: 'notify.test', gotifyToken: 'secret', [preference]: false });
      expect(await h.service.send({ kind, title: 'disabled', message: 'm' })).toBe(false);
      expect(h.notify).not.toHaveBeenCalled();
      expect(await h.service.send({ kind: other, title: 'enabled', message: 'm' })).toBe(true);
      expect(h.notify).toHaveBeenCalledTimes(1);
      expect(h.notify.mock.calls[0]?.[0]).not.toHaveProperty('kind');
    } finally { h.db.close(); }
  });

  test('disabled events skip before decrypting a damaged credential', async () => {
    const h = setup();
    try {
      h.service.saveSettings({ gotifyAddress: 'notify.test', gotifyToken: 'secret', notifyScriptResults: false, notifyDnsChanges: false });
      h.db.prepare("UPDATE app_settings SET gotify_token_encrypted = 'damaged'").run();
      expect(await h.service.send({ kind: 'script_result', title: 't', message: 'm' })).toBe(false);
      expect(await h.service.send({ kind: 'dns_change', title: 't', message: 'm' })).toBe(false);
      expect(h.notify).not.toHaveBeenCalled();
    } finally { h.db.close(); }
  });

  test('explicit test messages bypass automatic notification preferences', async () => {
    const h = setup();
    try {
      h.service.saveSettings({ gotifyAddress: 'notify.test', gotifyToken: 'secret', notifyScriptResults: false, notifyDnsChanges: false });
      expect(await h.service.test({})).toEqual({ sent: true });
      expect(h.notify).toHaveBeenCalledTimes(1);
    } finally { h.db.close(); }
  });
});


test('changing notification preferences can preserve an unreadable token without decrypting it', () => {
  const h = setup();
  try {
    h.service.saveSettings({ gotifyAddress: 'notify.test', gotifyToken: 'secret' });
    h.db.prepare("UPDATE app_settings SET gotify_token_encrypted = 'damaged'").run();
    expect(h.service.saveSettings({ notifyScriptResults: false, notifyDnsChanges: false })).toMatchObject({
      notifyScriptResults: false, notifyDnsChanges: false, hasGotifyToken: true,
    });
    expect(h.db.prepare('SELECT gotify_token_encrypted FROM app_settings').get()).toEqual({ gotify_token_encrypted: 'damaged' });
  } finally { h.db.close(); }
});
