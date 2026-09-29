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
      expect(await h.service.send({ title: 't', message: 'm' })).toBe(false);
      expect(h.notify).not.toHaveBeenCalled();
    } finally {
      h.db.close();
    }
  });

  test('sends with the stored credential', async () => {
    const h = setup();
    try {
      h.service.saveSettings({ gotifyAddress: 'notify.test', gotifyToken: 'secret' });

      expect(await h.service.send({ title: 'A run finished', message: 'exit 0' })).toBe(true);
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

      await expect(h.service.send({ title: 't', message: 'm' })).rejects.toThrow(
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
