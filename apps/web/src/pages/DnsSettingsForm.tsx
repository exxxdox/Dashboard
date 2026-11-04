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
import { ErrorBanner } from '../components/Feedback';
import { errorMessage } from '../api/client';
import { SecretField } from '../components/SecretField';
import { useDnsInterfaces, useSaveDnsSettings } from '../api/queries';
import { providerLabel } from '../lib/dns';
import { useI18n } from '../lib/i18n';

type FormState = {
  provider: DnsProviderName;
  ipv6Source: DnsSettingsView['ipv6Source'];
  localIpv6Interface: string;
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
  ipv6Source: 'ipify',
  localIpv6Interface: '',
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
    ipv6Source: settings.ipv6Source,
    localIpv6Interface: settings.localIpv6Interface,
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

  const interfaces = useDnsInterfaces(state.ipv6Source === 'local');
  // Keep disconnected saved interfaces selectable so loading the list cannot silently change settings.
  const interfaceNames = [...new Set([state.localIpv6Interface, ...(interfaces.data ?? [])])].filter(Boolean);

  const isCloudflare = state.provider === 'cloudflare';

  function patch(next: Partial<FormState>): void {
    setState((current) => ({ ...current, ...next }));
  }

  /** Only credentials that say something are sent; blank means "keep". */
  function buildUpdate(extra: UpdateDnsSettingsInput = {}): UpdateDnsSettingsInput {
    const input: UpdateDnsSettingsInput = {
      provider: state.provider,
      ipv6Source: state.ipv6Source,
      localIpv6Interface: state.localIpv6Interface,
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

      {/* Use one saved source so manual checks and scheduled updates cannot diverge. */}
      <Field label={t('dns.form.ipv6Source')} hint={t('dns.form.ipv6SourceHint')}>
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={state.ipv6Source}
            onChange={(event) => patch({ ipv6Source: event.target.value as FormState['ipv6Source'] })}
          >
            <option value="ipify">{t('dns.form.ipv6SourceIpify')}</option>
            <option value="local">{t('dns.form.ipv6SourceLocal')}</option>
          </Select>
        )}
      </Field>

      {/* A host with multiple uplinks needs an explicit interface to avoid publishing the wrong address. */}
      {state.ipv6Source === 'local' && (
        <Field label={t('dns.form.localIpv6Interface')} hint={t('dns.form.localIpv6InterfaceHint')}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              className="mono"
              value={state.localIpv6Interface}
              disabled={interfaces.isPending}
              onChange={(event) => patch({ localIpv6Interface: event.target.value })}
            >
              <option value="">{interfaces.isPending ? t('common.loading') : t('dns.form.localIpv6InterfaceAuto')}</option>
              {interfaceNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </Select>
          )}
        </Field>
      )}

      {state.ipv6Source === 'local' && interfaces.isError && (
        <ErrorBanner message={errorMessage(interfaces.error, i18n)} onRetry={() => void interfaces.refetch()} />
      )}

      {/* Native details keeps credentials available to keyboard and screen-reader users. */}
      <details>
        <summary className="focus-ring cursor-pointer font-semibold">{t('dns.form.credentials')}</summary>
        <div className="mt-4 grid gap-5">
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

        </div>
      </details>

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
