/**
 * Notifications: the settings that decide where they go, and the one way to
 * send one.
 *
 * The DNS console was the first caller and used to own this. It now asks this
 * service to send, so the next feature that wants to notify someone does not
 * have to reach into the DNS settings row to do it.
 *
 * A notification is a courtesy, never a step. `send` returns false when the
 * notifier is not configured -- a skip, not a failure -- and throws only when a
 * message was attempted and rejected. What a failure means is the caller's
 * decision; nothing here makes it for them.
 */

import type {
  AppSettingsView,
  NotificationTest,
  TestNotificationInput,
  UpdateAppSettingsInput,
} from '@dashboard/shared';

import type { Db } from '../../db/client.js';
import type { SecretBox } from '../../lib/crypto.js';
import { UpstreamError, ValidationError, errorMessage } from '../../lib/errors.js';
import { redactToken, sendGotify, type GotifyMessage } from './gotify.js';
import { getAppSettingsView, resolveNotificationSettings, saveAppSettings } from './settings.js';

/** What a caller asks to have sent. Where it lands is not its business. */
export type OutgoingNotification = {
  title: string;
  message: string;
};

export type NotificationServiceDeps = {
  db: Db;
  box: SecretBox;
  /**
   * Injected so a test can drive the whole path without a network, the same way
   * `createFakeTransport` stands in for ssh. The default is the real notifier.
   */
  notify?: (message: GotifyMessage) => Promise<boolean>;
};

export type NotificationService = {
  state: () => AppSettingsView;
  saveSettings: (input: UpdateAppSettingsInput) => AppSettingsView;
  /** Send one message with the given values, for a credential not yet saved. */
  test: (input: TestNotificationInput, signal?: AbortSignal) => Promise<NotificationTest>;
  /**
   * Send one message with the stored settings.
   *
   * False means nothing is configured, which is a skip rather than a failure:
   * an operator who does not want notifications should not have to read an
   * error about it on every run.
   */
  send: (notification: OutgoingNotification, signal?: AbortSignal) => Promise<boolean>;
};

export function createNotificationService(deps: NotificationServiceDeps): NotificationService {
  const { db, box } = deps;
  const notify = deps.notify ?? sendGotify;

  return {
    state: () => getAppSettingsView(db),

    saveSettings: (input) => saveAppSettings(db, box, input),

    async test(input, signal) {
      const settings = resolveNotificationSettings(db, box);
      // The form's value wins, so a credential can be tried before it is saved;
      // blank means "use what is stored", exactly as it does when saving.
      const address = pick(input.gotifyAddress, settings.gotifyAddress);
      const token = pick(input.gotifyToken, settings.gotifyToken ?? '');
      if (address === '' || token === '') {
        throw new ValidationError(
          'A Gotify address and token are both needed to send a test message',
          undefined,
          { key: 'error.notification.notConfigured' },
        );
      }

      try {
        await notify({
          address,
          token,
          title: 'Test notification',
          message: 'The dashboard reached this Gotify server.',
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        // Redacted because the token travels in a header and this string is
        // headed for both the response body and the log.
        throw new UpstreamError(
          `The test message could not be sent: ${redactToken(errorMessage(error))}`,
        );
      }
      return { sent: true };
    },

    async send(notification, signal) {
      const settings = resolveNotificationSettings(db, box);
      // Short-circuited here rather than left to the notifier: "not configured"
      // is a property of these settings, and a transport asked to POST to an
      // empty address would be right to call that a bug rather than a skip.
      if (settings.gotifyAddress.trim() === '' || (settings.gotifyToken ?? '').trim() === '') {
        return false;
      }
      return notify({
        address: settings.gotifyAddress,
        token: settings.gotifyToken ?? '',
        title: notification.title,
        message: notification.message,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}

/** A form value when it says something, otherwise the stored one. */
function pick(provided: string | undefined, stored: string): string {
  const trimmed = (provided ?? '').trim();
  return trimmed === '' ? stored.trim() : trimmed;
}
