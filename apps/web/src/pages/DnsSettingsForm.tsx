/**
 * The DNS settings form.
 *
 * Credentials follow the same rule as a target's: the API never returns one, so
 * a blank box means "keep the stored value" and deleting one is its own button.
 * `components/SecretField.tsx` owns that rule now that a second form needs it.
 *
 * The Gotify section used to live here. It moved to the settings page, because
 * where a notification goes is a property of the dashboard rather than of this
 * console -- and this form is the better for it: what is left is only what an
 * AAAA record needs.
 */

import { useState, type FormEvent } from 'react';
import type { DnsProviderName, DnsSettingsView, UpdateDnsSettingsInput } from '@dashboard/shared';
import { Save } from 'lucide-react';

import { Button } from '../components/Button';
import { Field, Select, Switch, TextInput } from '../components/Form';
import { SecretField } from '../components/SecretField';
import { useSaveDnsSettings } from '../api/queries';
import { providerLabel } from '../lib/dns';
import { useI18n } from '../lib/i18n';

type FormState = {
  provider: DnsProviderName;
  scheduleEnabled: boolean;
  intervalMinutes: string;
  cloudflareZoneId: string;
  cloudflareRecordName: string;
  cloudflareToken: string;
  alibabaAccessKeyId: string;
  alibabaRecordId: string;
  alibabaAccessKeySecret: string;
};

const EMPTY: FormState = {
  provider: 'cloudflare',
  scheduleEnabled: false,
  intervalMinutes: '10',
  cloudflareZoneId: '',
  cloudflareRecordName: '',
  cloudflareToken: '',
  alibabaAccessKeyId: '',
  alibabaRecordId: '',
  alibabaAccessKeySecret: '',
};

/** Secrets are never sent back, so they start blank on every load. */
function toFormState(settings: DnsSettingsView | null): FormState {
  if (!settings) return EMPTY;
  return {
    ...EMPTY,
    provider: settings.provider,
    scheduleEnabled: settings.scheduleEnabled,
    intervalMinutes: String(settings.intervalMinutes),
    cloudflareZoneId: settings.cloudflareZoneId,
    cloudflareRecordName: settings.cloudflareRecordName,
    alibabaAccessKeyId: settings.alibabaAccessKeyId,
    alibabaRecordId: settings.alibabaRecordId,
  };
}

export function DnsSettingsForm({ settings }: { settings: DnsSettingsView | null }) {
  const i18n = useI18n();
  const { t } = i18n;
  const save = useSaveDnsSettings();
  const [state, setState] = useState<FormState>(() => toFormState(settings));

  const isCloudflare = state.provider === 'cloudflare';

  function patch(next: Partial<FormState>): void {
    setState((current) => ({ ...current, ...next }));
  }

  /** Only credentials that say something are sent; blank means "keep". */
  function buildUpdate(extra: UpdateDnsSettingsInput = {}): UpdateDnsSettingsInput {
    const input: UpdateDnsSettingsInput = {
      provider: state.provider,
      scheduleEnabled: state.scheduleEnabled,
      intervalMinutes: Number(state.intervalMinutes),
      cloudflareZoneId: state.cloudflareZoneId,
      cloudflareRecordName: state.cloudflareRecordName,
      alibabaAccessKeyId: state.alibabaAccessKeyId,
      alibabaRecordId: state.alibabaRecordId,
      ...extra,
    };
    if (state.cloudflareToken !== '') input.cloudflareToken = state.cloudflareToken;
    if (state.alibabaAccessKeySecret !== '') {
      input.alibabaAccessKeySecret = state.alibabaAccessKeySecret;
    }
    return input;
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    // The save reports itself through a toast; what is left here is the part a
    // toast cannot do.
    save.mutate(buildUpdate(), {
      onSuccess: () => {
        // Empty the credential boxes: the server now holds those values, and
        // leaving them filled would make the next save look like a change.
        setState((current) => ({
          ...current,
          cloudflareToken: '',
          alibabaAccessKeySecret: '',
        }));
      },
    });
  }

  function clear(flag: 'clearCloudflareToken' | 'clearAlibabaAccessKeySecret'): void {
    save.mutate(buildUpdate({ [flag]: true }));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <Field label={t('dns.form.provider')} hint={t('dns.form.providerHint')}>
        {({ id }) => (
          <Select
            id={id}
            value={state.provider}
            onChange={(event) => patch({ provider: event.target.value as DnsProviderName })}
          >
            <option value="cloudflare">{providerLabel(t, 'cloudflare')}</option>
            <option value="alibaba">{providerLabel(t, 'alibaba')}</option>
          </Select>
        )}
      </Field>

      {isCloudflare ? (
        <>
          <SecretField
            label={t('dns.form.cloudflareToken')}
            hint={t('dns.form.cloudflareTokenHint')}
            saved={settings?.hasCloudflareToken ?? false}
            value={state.cloudflareToken}
            onChange={(value) => patch({ cloudflareToken: value })}
            onClear={() => clear('clearCloudflareToken')}
            blockedReason={t('dns.form.blockedClear')}
            pending={save.isPending}
          />
          <Field label={t('dns.form.zoneId')}>
            {({ id }) => (
              <TextInput
                id={id}
                className="mono"
                value={state.cloudflareZoneId}
                placeholder="023e105f4ecef8ad9ca31a8372d0c353"
                onChange={(event) => patch({ cloudflareZoneId: event.target.value })}
              />
            )}
          </Field>
          <Field label={t('dns.form.recordName')} hint={t('dns.form.recordNameHint')}>
            {({ id }) => (
              <TextInput
                id={id}
                className="mono"
                value={state.cloudflareRecordName}
                placeholder="home.example.com"
                onChange={(event) => patch({ cloudflareRecordName: event.target.value })}
              />
            )}
          </Field>
        </>
      ) : (
        <>
          <Field label={t('dns.form.alibabaAccessKeyId')}>
            {({ id }) => (
              <TextInput
                id={id}
                className="mono"
                value={state.alibabaAccessKeyId}
                autoComplete="off"
                onChange={(event) => patch({ alibabaAccessKeyId: event.target.value })}
              />
            )}
          </Field>
          <SecretField
            label={t('dns.form.alibabaAccessKeySecret')}
            saved={settings?.hasAlibabaAccessKeySecret ?? false}
            value={state.alibabaAccessKeySecret}
            onChange={(value) => patch({ alibabaAccessKeySecret: value })}
            onClear={() =>
              clear('clearAlibabaAccessKeySecret')
            }
            blockedReason={t('dns.form.blockedClear')}
            pending={save.isPending}
          />
          <Field label={t('dns.form.alibabaRecordId')} hint={t('dns.form.alibabaRecordIdHint')}>
            {({ id }) => (
              <TextInput
                id={id}
                className="mono"
                value={state.alibabaRecordId}
                onChange={(event) => patch({ alibabaRecordId: event.target.value })}
              />
            )}
          </Field>
        </>
      )}

      <div className="border-line grid gap-5 border-t pt-5">
        <Switch
          checked={state.scheduleEnabled}
          onChange={(checked) => patch({ scheduleEnabled: checked })}
          label={t('dns.form.scheduleEnable')}
        />
        <Field label={t('dns.form.interval')} hint={t('dns.form.intervalHint')}>
          {({ id }) => (
            <TextInput
              id={id}
              className="mono w-36"
              type="number"
              min={1}
              max={10080}
              disabled={!state.scheduleEnabled}
              value={state.intervalMinutes}
              onChange={(event) => patch({ intervalMinutes: event.target.value })}
            />
          )}
        </Field>
      </div>


      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          icon={<Save className="size-[18px]" aria-hidden />}
          loading={save.isPending}
        >
          {t('dns.form.save')}
        </Button>
      </div>
    </form>
  );
}
