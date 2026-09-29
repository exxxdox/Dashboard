/**
 * The DNS settings row: one row, three encrypted credentials, and the rules
 * about which of them may be empty.
 *
 * Two shapes come out of here and they are not interchangeable:
 *
 * - `DnsSettingsView` is what the API returns. It has no field a credential
 *   could travel in -- each one is reduced to a `has*` boolean -- so a route
 *   cannot leak one by forgetting to delete it. This is the `TargetSummary`
 *   rule applied again.
 * - `ResolvedDnsSettings` has them decrypted, and exists only for a provider or
 *   the notifier, inside the service.
 */

import type { DnsProviderName, DnsSettingsView, UpdateDnsSettingsInput } from '@dashboard/shared';
import { MAX_DNS_INTERVAL_MINUTES, MIN_DNS_INTERVAL_MINUTES } from '@dashboard/shared';

import type { Db } from '../../db/client.js';
import { nowIso } from '../../db/client.js';
import type { SecretBox } from '../../lib/crypto.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';
import type { ResolvedDnsSettings } from './types.js';

/**
 * The settings are a single row with a fixed id rather than a generated one:
 * there is exactly one AAAA record being kept pointed at one address, and saying
 * so in the data means the read path cannot return two answers.
 */
const SETTINGS_ID = 'dns';

/** The record type this whole feature exists to maintain. */
const ALIBABA_RECORD_TYPE = 'AAAA';

export type DnsSettingsRow = {
  id: string;
  provider: DnsProviderName;
  schedule_enabled: number;
  interval_minutes: number;
  cloudflare_zone_id: string;
  cloudflare_record_name: string;
  cloudflare_token_encrypted: string | null;
  alibaba_access_key_id: string;
  alibaba_record_id: string;
  alibaba_record_type: string;
  alibaba_access_key_secret_encrypted: string | null;
  gotify_address: string;
  gotify_token_encrypted: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * The settings as an editable form: plain strings, no encryption, no database
 * column names. A credential is either a value to store or null for "leave
 * whatever is stored alone".
 */
export type MutableSettings = {
  provider: DnsProviderName;
  scheduleEnabled: boolean;
  intervalMinutes: number;
  cloudflareZoneId: string;
  cloudflareRecordName: string;
  cloudflareToken: string | null;
  alibabaAccessKeyId: string;
  alibabaRecordId: string;
  alibabaAccessKeySecret: string | null;
  gotifyAddress: string;
  gotifyToken: string | null;
};

/** What a fresh install has, before anything has been saved. */
function defaults(): MutableSettings {
  return {
    provider: 'cloudflare',
    scheduleEnabled: false,
    intervalMinutes: 10,
    cloudflareZoneId: '',
    cloudflareRecordName: '',
    cloudflareToken: null,
    alibabaAccessKeyId: '',
    alibabaRecordId: '',
    alibabaAccessKeySecret: null,
    gotifyAddress: '',
    gotifyToken: null,
  };
}

/** The stored row, or null when nothing has been saved yet. */
export function readSettingsRow(db: Db): DnsSettingsRow | null {
  return (
    db
      .prepare<[string], DnsSettingsRow>('SELECT * FROM dns_settings WHERE id = ?')
      .get(SETTINGS_ID) ?? null
  );
}

/**
 * The API's shape, or null when nothing has been saved.
 *
 * A missing row and a row full of empty strings are different states, and the
 * page has to tell them apart: only the first should point an operator at the
 * form as the next step.
 */
export function getSettingsView(db: Db): DnsSettingsView | null {
  const row = readSettingsRow(db);
  return row ? toSettingsView(row) : null;
}

export function toSettingsView(row: DnsSettingsRow): DnsSettingsView {
  return {
    provider: row.provider,
    scheduleEnabled: row.schedule_enabled === 1,
    intervalMinutes: row.interval_minutes,
    cloudflareZoneId: row.cloudflare_zone_id,
    cloudflareRecordName: row.cloudflare_record_name,
    // The presence of an encrypted value is the whole answer: nothing is ever
    // stored as an empty string, so a non-null column means a real credential.
    hasCloudflareToken: row.cloudflare_token_encrypted !== null,
    alibabaAccessKeyId: row.alibaba_access_key_id,
    alibabaRecordId: row.alibaba_record_id,
    alibabaRecordType: ALIBABA_RECORD_TYPE,
    hasAlibabaAccessKeySecret: row.alibaba_access_key_secret_encrypted !== null,
    gotifyAddress: row.gotify_address,
    hasGotifyToken: row.gotify_token_encrypted !== null,
    updatedAt: row.updated_at,
  };
}

/** Settings with the credentials decrypted, or null when nothing is saved. */
export function resolveSettings(db: Db, box: SecretBox): ResolvedDnsSettings | null {
  const row = readSettingsRow(db);
  if (!row) return null;
  const settings = fromRow(row, box);
  return {
    provider: settings.provider,
    scheduleEnabled: settings.scheduleEnabled,
    intervalMinutes: settings.intervalMinutes,
    cloudflareToken: settings.cloudflareToken ?? '',
    cloudflareZoneId: settings.cloudflareZoneId,
    cloudflareRecordName: settings.cloudflareRecordName,
    alibabaAccessKeyId: settings.alibabaAccessKeyId,
    alibabaAccessKeySecret: settings.alibabaAccessKeySecret ?? '',
    alibabaRecordId: settings.alibabaRecordId,
    alibabaRecordType: ALIBABA_RECORD_TYPE,
    gotifyAddress: settings.gotifyAddress,
    gotifyToken: settings.gotifyToken ?? '',
  };
}

/**
 * The same, with empty strings where nothing is saved.
 *
 * Used by the notification test, which has to be able to try a credential that
 * has not been saved yet -- so "no settings row at all" and "a row with an empty
 * Gotify address" have to look alike to it.
 */
export function resolveSettingsOrEmpty(db: Db, box: SecretBox): ResolvedDnsSettings {
  const resolved = resolveSettings(db, box);
  if (resolved) return resolved;
  const empty = defaults();
  return {
    provider: empty.provider,
    scheduleEnabled: empty.scheduleEnabled,
    intervalMinutes: empty.intervalMinutes,
    cloudflareToken: '',
    cloudflareZoneId: '',
    cloudflareRecordName: '',
    alibabaAccessKeyId: '',
    alibabaAccessKeySecret: '',
    alibabaRecordId: '',
    alibabaRecordType: ALIBABA_RECORD_TYPE,
    gotifyAddress: '',
    gotifyToken: '',
  };
}

/**
 * Apply a partial update, validate the result, and store it.
 *
 * Validation runs on the merged settings rather than on the request: the form
 * saves a whole state, and a field that was valid to omit is still required to be
 * present afterwards.
 */
export function saveSettings(
  db: Db,
  box: SecretBox,
  input: UpdateDnsSettingsInput,
): DnsSettingsView {
  const row = readSettingsRow(db);
  const merged = merge(row, input, box);

  const problem = validate(merged);
  if (problem !== null) throw new ValidationError(problem);

  const timestamp = nowIso();
  if (row) {
    db.prepare(
      `UPDATE dns_settings SET
         provider = ?, schedule_enabled = ?, interval_minutes = ?,
         cloudflare_zone_id = ?, cloudflare_record_name = ?, cloudflare_token_encrypted = ?,
         alibaba_access_key_id = ?, alibaba_record_id = ?, alibaba_record_type = ?,
         alibaba_access_key_secret_encrypted = ?,
         gotify_address = ?, gotify_token_encrypted = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      merged.provider,
      merged.scheduleEnabled ? 1 : 0,
      merged.intervalMinutes,
      merged.cloudflareZoneId,
      merged.cloudflareRecordName,
      encrypt(merged.cloudflareToken, box),
      merged.alibabaAccessKeyId,
      merged.alibabaRecordId,
      ALIBABA_RECORD_TYPE,
      encrypt(merged.alibabaAccessKeySecret, box),
      merged.gotifyAddress,
      encrypt(merged.gotifyToken, box),
      timestamp,
      SETTINGS_ID,
    );
  } else {
    db.prepare(
      `INSERT INTO dns_settings (
         id, provider, schedule_enabled, interval_minutes,
         cloudflare_zone_id, cloudflare_record_name, cloudflare_token_encrypted,
         alibaba_access_key_id, alibaba_record_id, alibaba_record_type,
         alibaba_access_key_secret_encrypted,
         gotify_address, gotify_token_encrypted, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      SETTINGS_ID,
      merged.provider,
      merged.scheduleEnabled ? 1 : 0,
      merged.intervalMinutes,
      merged.cloudflareZoneId,
      merged.cloudflareRecordName,
      encrypt(merged.cloudflareToken, box),
      merged.alibabaAccessKeyId,
      merged.alibabaRecordId,
      ALIBABA_RECORD_TYPE,
      encrypt(merged.alibabaAccessKeySecret, box),
      merged.gotifyAddress,
      encrypt(merged.gotifyToken, box),
      timestamp,
      timestamp,
    );
  }

  const stored = readSettingsRow(db);
  if (!stored) throw new ConflictError('The DNS settings could not be stored');
  return toSettingsView(stored);
}

/**
 * Fold a partial request into the current state.
 *
 * The rule for credentials, in order:
 *   - an explicit clear flag wins, because asking for a deletion is always
 *     deliberate;
 *   - otherwise a non-blank value replaces what is stored;
 *   - otherwise a blank or absent value keeps it, because the API never returns
 *     a credential for the form to send back.
 *
 * Note what that means for a request that clears the active provider's required
 * credential: validation rejects it below, with the field named, rather than this
 * function having a second opinion about it.
 */
function merge(
  row: DnsSettingsRow | null,
  input: UpdateDnsSettingsInput,
  box: SecretBox,
): MutableSettings {
  const base = row ? fromRow(row, box) : defaults();

  return {
    provider: input.provider ?? base.provider,
    scheduleEnabled: input.scheduleEnabled ?? base.scheduleEnabled,
    intervalMinutes: input.intervalMinutes ?? base.intervalMinutes,
    cloudflareZoneId: text(input.cloudflareZoneId, base.cloudflareZoneId),
    cloudflareRecordName: text(input.cloudflareRecordName, base.cloudflareRecordName),
    cloudflareToken: secret(
      input.cloudflareToken,
      input.clearCloudflareToken,
      base.cloudflareToken,
    ),
    alibabaAccessKeyId: text(input.alibabaAccessKeyId, base.alibabaAccessKeyId),
    alibabaRecordId: text(input.alibabaRecordId, base.alibabaRecordId),
    alibabaAccessKeySecret: secret(
      input.alibabaAccessKeySecret,
      input.clearAlibabaAccessKeySecret,
      base.alibabaAccessKeySecret,
    ),
    gotifyAddress: text(input.gotifyAddress, base.gotifyAddress),
    gotifyToken: secret(input.gotifyToken, input.clearGotifyToken, base.gotifyToken),
  };
}

function fromRow(row: DnsSettingsRow, box: SecretBox): MutableSettings {
  return {
    provider: row.provider,
    scheduleEnabled: row.schedule_enabled === 1,
    intervalMinutes: row.interval_minutes,
    cloudflareZoneId: row.cloudflare_zone_id,
    cloudflareRecordName: row.cloudflare_record_name,
    cloudflareToken: optionalDecrypt(row.cloudflare_token_encrypted, box, 'Cloudflare token'),
    alibabaAccessKeyId: row.alibaba_access_key_id,
    alibabaRecordId: row.alibaba_record_id,
    alibabaAccessKeySecret: optionalDecrypt(
      row.alibaba_access_key_secret_encrypted,
      box,
      'Alibaba Cloud access key secret',
    ),
    gotifyAddress: row.gotify_address,
    gotifyToken: optionalDecrypt(row.gotify_token_encrypted, box, 'Gotify token'),
  };
}

/**
 * The subset of a settings shape the rules actually read.
 *
 * Both shapes in this module satisfy it, so a run can be validated before it
 * starts without first reassembling the settings it just read.
 */
export type ValidatableSettings = {
  provider: DnsProviderName;
  intervalMinutes: number;
  cloudflareToken: string | null;
  cloudflareZoneId: string;
  cloudflareRecordName: string;
  alibabaAccessKeyId: string;
  alibabaAccessKeySecret: string | null;
  alibabaRecordId: string;
};

/**
 * The rules a stored configuration has to satisfy.
 *
 * Returns the message rather than throwing, so a caller can ask "is this runnable"
 * without a failure being the shape of the answer.
 *
 * Only the active provider's credentials are required: an operator switching from
 * Cloudflare to Alibaba Cloud should not have to keep the old token alive, and
 * keeping it is what makes switching back cheap.
 */
export function validate(settings: ValidatableSettings): string | null {
  if (settings.intervalMinutes < MIN_DNS_INTERVAL_MINUTES) {
    return `The check interval must be at least ${MIN_DNS_INTERVAL_MINUTES} minute`;
  }
  if (settings.intervalMinutes > MAX_DNS_INTERVAL_MINUTES) {
    return `The check interval must be at most ${MAX_DNS_INTERVAL_MINUTES} minutes`;
  }

  const missing: string[] = [];
  if (settings.provider === 'cloudflare') {
    if (isBlank(settings.cloudflareToken)) missing.push('Cloudflare API token');
    if (isBlank(settings.cloudflareZoneId)) missing.push('Cloudflare zone id');
    if (isBlank(settings.cloudflareRecordName)) missing.push('Cloudflare record name');
  } else {
    if (isBlank(settings.alibabaAccessKeyId)) missing.push('Alibaba Cloud access key id');
    if (isBlank(settings.alibabaAccessKeySecret)) missing.push('Alibaba Cloud access key secret');
    if (isBlank(settings.alibabaRecordId)) missing.push('Alibaba Cloud record id');
  }

  if (missing.length > 0) return `The selected provider still needs: ${missing.join(', ')}`;
  return null;
}

function text(provided: string | undefined, current: string): string {
  return provided === undefined ? current : provided.trim();
}

function secret(
  provided: string | undefined,
  clear: boolean | undefined,
  current: string | null,
): string | null {
  if (clear === true) return null;
  if (provided === undefined) return current;
  const trimmed = provided.trim();
  // Blank means "keep", not "erase": see the note on `merge`.
  return trimmed === '' ? current : trimmed;
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

function encrypt(value: string | null, box: SecretBox): string | null {
  return value === null ? null : box.encrypt(value);
}

function optionalDecrypt(value: string | null, box: SecretBox, what: string): string | null {
  return value === null ? null : decryptOrExplain(value, box, what);
}

/**
 * A stored credential that will not decrypt means `secret.key` was replaced or
 * lost, and the operator has to re-enter the credential to fix it. A 409 rather
 * than a 500 because the request itself is fine -- what conflicts is the stored
 * state -- and the message is the only part of this that helps.
 */
function decryptOrExplain(value: string, box: SecretBox, what: string): string {
  try {
    return box.decrypt(value);
  } catch {
    throw new ConflictError(
      `${what} cannot be decrypted: the secret key has changed. Re-enter the saved credentials.`,
    );
  }
}
