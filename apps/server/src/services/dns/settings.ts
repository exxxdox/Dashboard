/**
 * The DNS settings row: one row, one encrypted credential, and its validation rules.
 *
 * Two shapes come out of here and they are not interchangeable:
 *
 * - `DnsSettingsView` is what the API returns. It has no field a credential
 *   could travel in -- each one is reduced to a `has*` boolean -- so a route
 *   cannot leak one by forgetting to delete it. This is the `TargetSummary`
 *   rule applied again.
 * - `ResolvedDnsSettings` has them decrypted, and exists only for a provider,
 *   inside the service.
 *
 * The notification address is not here: it belongs to the dashboard rather than
 * to this console, and lives in `services/notifications/settings.ts`.
 */

import type {
  DnsProviderName,
  DnsIpv6Source,
  DnsSettingsView,
  ErrorI18n,
  UpdateDnsSettingsInput,
} from '@dashboard/shared';
import { MAX_DNS_INTERVAL_MINUTES, MIN_DNS_INTERVAL_MINUTES } from '@dashboard/shared';

import type { Db } from '../../db/client.js';
import { nowIso } from '../../db/client.js';
import type { SecretBox } from '../../lib/crypto.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';
import {
  decryptOptionalSecret,
  encryptSecret,
  isBlank,
  mergeSecret,
  textField,
} from '../../lib/secrets.js';
import type { ResolvedDnsSettings } from './types.js';

/**
 * The settings are a single row with a fixed id rather than a generated one:
 * there is exactly one AAAA record being kept pointed at one address, and saying
 * so in the data means the read path cannot return two answers.
 */
const SETTINGS_ID = 'dns';

export type DnsSettingsRow = {
  id: string;
  provider: DnsProviderName;
  ipv6_source: DnsIpv6Source;
  local_ipv6_interface: string;
  schedule_enabled: number;
  interval_minutes: number;
  cloudflare_zone_id: string;
  cloudflare_record_name: string;
  cloudflare_token_encrypted: string | null;
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
  ipv6Source: DnsIpv6Source;
  localIpv6Interface: string;
  scheduleEnabled: boolean;
  intervalMinutes: number;
  cloudflareZoneId: string;
  cloudflareRecordName: string;
  cloudflareToken: string | null;
};

/** What a fresh install has, before anything has been saved. */
function defaults(): MutableSettings {
  return {
    provider: 'cloudflare',
    ipv6Source: 'ipify',
    localIpv6Interface: '',
    scheduleEnabled: false,
    intervalMinutes: 10,
    cloudflareZoneId: '',
    cloudflareRecordName: '',
    cloudflareToken: null,
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
    ipv6Source: row.ipv6_source,
    localIpv6Interface: row.local_ipv6_interface,
    scheduleEnabled: row.schedule_enabled === 1,
    intervalMinutes: row.interval_minutes,
    cloudflareZoneId: row.cloudflare_zone_id,
    cloudflareRecordName: row.cloudflare_record_name,
    // The presence of an encrypted value is the whole answer: nothing is ever
    // stored as an empty string, so a non-null column means a real credential.
    hasCloudflareToken: row.cloudflare_token_encrypted !== null,
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
    ipv6Source: settings.ipv6Source,
    localIpv6Interface: settings.localIpv6Interface,
    scheduleEnabled: settings.scheduleEnabled,
    intervalMinutes: settings.intervalMinutes,
    cloudflareToken: settings.cloudflareToken ?? '',
    cloudflareZoneId: settings.cloudflareZoneId,
    cloudflareRecordName: settings.cloudflareRecordName,
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
  if (problem !== null) throw new ValidationError(problem.message, undefined, problem.i18n);

  const timestamp = nowIso();
  // One statement for both cases: the row either does not exist yet (the insert
  // half) or is replaced by exactly these values (the update half). `created_at`
  // is set on insert only, so a rewrite cannot claim the settings are newer than
  // the credential in them.
  db.prepare(
    `INSERT INTO dns_settings (
       id, provider, ipv6_source, local_ipv6_interface, schedule_enabled, interval_minutes,
       cloudflare_zone_id, cloudflare_record_name, cloudflare_token_encrypted,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider = excluded.provider,
       ipv6_source = excluded.ipv6_source,
       local_ipv6_interface = excluded.local_ipv6_interface,
       schedule_enabled = excluded.schedule_enabled,
       interval_minutes = excluded.interval_minutes,
       cloudflare_zone_id = excluded.cloudflare_zone_id,
       cloudflare_record_name = excluded.cloudflare_record_name,
       cloudflare_token_encrypted = excluded.cloudflare_token_encrypted,
       updated_at = excluded.updated_at`,
  ).run(
    SETTINGS_ID,
    merged.provider,
    merged.ipv6Source,
    merged.localIpv6Interface,
    merged.scheduleEnabled ? 1 : 0,
    merged.intervalMinutes,
    merged.cloudflareZoneId,
    merged.cloudflareRecordName,
    encryptSecret(merged.cloudflareToken, box),
    timestamp,
    timestamp,
  );

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
    ipv6Source: input.ipv6Source ?? base.ipv6Source,
    localIpv6Interface: textField(input.localIpv6Interface, base.localIpv6Interface),
    scheduleEnabled: input.scheduleEnabled ?? base.scheduleEnabled,
    intervalMinutes: input.intervalMinutes ?? base.intervalMinutes,
    cloudflareZoneId: textField(input.cloudflareZoneId, base.cloudflareZoneId),
    cloudflareRecordName: textField(input.cloudflareRecordName, base.cloudflareRecordName),
    cloudflareToken: mergeSecret(
      input.cloudflareToken,
      input.clearCloudflareToken,
      base.cloudflareToken,
    ),
  };
}

function fromRow(row: DnsSettingsRow, box: SecretBox): MutableSettings {
  return {
    provider: row.provider,
    ipv6Source: row.ipv6_source,
    localIpv6Interface: row.local_ipv6_interface,
    scheduleEnabled: row.schedule_enabled === 1,
    intervalMinutes: row.interval_minutes,
    cloudflareZoneId: row.cloudflare_zone_id,
    cloudflareRecordName: row.cloudflare_record_name,
    cloudflareToken: decryptOptionalSecret(row.cloudflare_token_encrypted, box, 'Cloudflare token'),
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
};

/**
 * What is wrong with a configuration, in both the forms it has to take.
 *
 * `message` is what the log records and what a client with no wording of its
 * own shows; `i18n` names the same fact for a client that does have one.
 * Returning both, rather than a code alone, is what keeps the log readable
 * without making the wire message the only thing a reader can ever see.
 */
export type SettingsProblem = {
  message: string;
  i18n: ErrorI18n;
};

/** A field that is missing: named for a sentence, identified for a lookup. */
type MissingField = {
  /** The identifier the client translates, e.g. `cloudflareZoneId`. */
  field: string;
  /** English, for the log and for the server's own sentence. */
  label: string;
};

/**
 * The rules a stored configuration has to satisfy.
 *
 * Returns the problem rather than throwing, so a caller can ask "is this
 * runnable" without a failure being the shape of the answer.
 */
export function validate(settings: ValidatableSettings): SettingsProblem | null {
  if (settings.intervalMinutes < MIN_DNS_INTERVAL_MINUTES) {
    return {
      message: `The check interval must be at least ${MIN_DNS_INTERVAL_MINUTES} minute`,
      i18n: { key: 'error.dns.intervalTooSmall', params: { min: MIN_DNS_INTERVAL_MINUTES } },
    };
  }
  if (settings.intervalMinutes > MAX_DNS_INTERVAL_MINUTES) {
    return {
      message: `The check interval must be at most ${MAX_DNS_INTERVAL_MINUTES} minutes`,
      i18n: { key: 'error.dns.intervalTooLarge', params: { max: MAX_DNS_INTERVAL_MINUTES } },
    };
  }

  const missing: MissingField[] = [];
  if (isBlank(settings.cloudflareToken)) {
    missing.push({ field: 'cloudflareToken', label: 'Cloudflare API token' });
  }
  if (isBlank(settings.cloudflareZoneId)) {
    missing.push({ field: 'cloudflareZoneId', label: 'Cloudflare zone id' });
  }
  if (isBlank(settings.cloudflareRecordName)) {
    missing.push({ field: 'cloudflareRecordName', label: 'Cloudflare record name' });
  }

  if (missing.length > 0) {
    return {
      message: `The selected provider still needs: ${missing.map((item) => item.label).join(', ')}`,
      i18n: {
        key: 'error.dns.missingCredentials',
        // The identifiers travel, not the English labels: a client that can
        // name these fields does so, and one that cannot falls back to
        // `message`, which still reads correctly on its own.
        params: { provider: settings.provider, fields: missing.map((item) => item.field) },
      },
    };
  }
  return null;
}
