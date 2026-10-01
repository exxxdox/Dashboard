/**
 * The application settings row: one row, and the credential it holds.
 *
 * The shape rules are the DNS settings' rules because it is the same problem:
 * `AppSettingsView` has no field a credential could travel in, and a blank or
 * absent credential from the client means "keep the stored one".
 *
 * What is different is that nothing here is required. There is no `validate`,
 * because an address without a token is not a broken configuration -- it is a
 * notifier that has not been set up yet, which is the state every install
 * starts in and a state the dashboard runs perfectly well in.
 */

import type { AppSettingsView, UpdateAppSettingsInput } from '@dashboard/shared';

import type { Db } from '../../db/client.js';
import { nowIso } from '../../db/client.js';
import type { SecretBox } from '../../lib/crypto.js';
import { ConflictError } from '../../lib/errors.js';
import {
  decryptOptionalSecret,
  encryptSecret,
  mergeSecret,
  textField,
} from '../../lib/secrets.js';

/**
 * One row with a fixed id, for the same reason the DNS settings have one: there
 * is exactly one dashboard, and saying so in the data means the read path
 * cannot return two answers.
 */
const SETTINGS_ID = 'app';

export type AppSettingsRow = {
  id: string;
  gotify_address: string;
  gotify_token_encrypted: string | null;
  created_at: string;
  updated_at: string;
};

/** The settings as an editable form: plain strings, no encryption, no columns. */
export type MutableAppSettings = {
  gotifyAddress: string;
  gotifyToken: string | null;
};

/** What a fresh install has, before anything has been saved. */
function defaults(): MutableAppSettings {
  return { gotifyAddress: '', gotifyToken: null };
}

/** The stored row, or null when nothing has been saved yet. */
export function readSettingsRow(db: Db): AppSettingsRow | null {
  return (
    db
      .prepare<[string], AppSettingsRow>('SELECT * FROM app_settings WHERE id = ?')
      .get(SETTINGS_ID) ?? null
  );
}

/**
 * The API's shape.
 *
 * Never null, unlike the DNS settings: the settings page always renders its
 * form, so there is no branch that "nothing is saved yet" would have to feed.
 * `updatedAt` is the signal instead, and it is null exactly until the first save.
 */
export function getAppSettingsView(db: Db): AppSettingsView {
  const row = readSettingsRow(db);
  if (!row) {
    return { gotifyAddress: '', hasGotifyToken: false, notificationsReady: false, updatedAt: null };
  }
  return toView(row);
}

function toView(row: AppSettingsRow): AppSettingsView {
  const hasGotifyToken = row.gotify_token_encrypted !== null;
  return {
    gotifyAddress: row.gotify_address,
    hasGotifyToken,
    // Derived rather than stored: a third column could disagree with these two,
    // and "ready" is not a fact anyone can hold separately from them.
    notificationsReady: hasGotifyToken && row.gotify_address.trim() !== '',
    updatedAt: row.updated_at,
  };
}

/**
 * The settings with the credential decrypted, for the notifier.
 *
 * Returns empty settings rather than null when nothing is saved, because a
 * notifier that has not been configured and one configured with nothing are the
 * same thing to every caller: a message that is not sent.
 */
export function resolveNotificationSettings(db: Db, box: SecretBox): MutableAppSettings {
  const row = readSettingsRow(db);
  if (!row) return defaults();
  return {
    gotifyAddress: row.gotify_address,
    gotifyToken: decryptOptionalSecret(row.gotify_token_encrypted, box, 'Gotify token'),
  };
}

/** Fold a partial request into the current state, and store the result. */
export function saveAppSettings(
  db: Db,
  box: SecretBox,
  input: UpdateAppSettingsInput,
): AppSettingsView {
  const row = readSettingsRow(db);
  const base: MutableAppSettings = row
    ? {
        gotifyAddress: row.gotify_address,
        gotifyToken: decryptOptionalSecret(row.gotify_token_encrypted, box, 'Gotify token'),
      }
    : defaults();

  const merged: MutableAppSettings = {
    gotifyAddress: textField(input.gotifyAddress, base.gotifyAddress),
    gotifyToken: mergeSecret(input.gotifyToken, input.clearGotifyToken, base.gotifyToken),
  };

  const timestamp = nowIso();
  // `created_at` belongs to the insert half only: replacing the address or the
  // token does not change when the row was first written.
  db.prepare(
    `INSERT INTO app_settings (id, gotify_address, gotify_token_encrypted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       gotify_address = excluded.gotify_address,
       gotify_token_encrypted = excluded.gotify_token_encrypted,
       updated_at = excluded.updated_at`,
  ).run(SETTINGS_ID, merged.gotifyAddress, encryptSecret(merged.gotifyToken, box), timestamp, timestamp);

  const stored = readSettingsRow(db);
  if (!stored) throw new ConflictError('The application settings could not be stored');
  return toView(stored);
}
