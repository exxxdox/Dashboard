/**
 * The DNS settings form.
 *
 * Credentials follow the same rule as a target's: the API never returns one, so
 * a blank box means "keep the stored value" and deleting one is its own button.
 * The Saved / Not set marker beside each is what makes that legible -- without
 * it, blank is indistinguishable from never having been set.
 */

import { useState, type FormEvent } from 'react';
import type { DnsProviderName, DnsSettingsView, UpdateDnsSettingsInput } from '@dashboard/shared';
import { Save, Send, Trash2 } from 'lucide-react';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/Feedback';
import { Field, Select, Switch, TextInput } from '../components/Form';
import { errorMessage } from '../api/client';
import { useSaveDnsSettings, useTestDnsNotification } from '../api/queries';

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
  gotifyAddress: string;
  gotifyToken: string;
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
  gotifyAddress: '',
  gotifyToken: '',
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
    gotifyAddress: settings.gotifyAddress,
  };
}

export function DnsSettingsForm({ settings }: { settings: DnsSettingsView | null }) {
  const save = useSaveDnsSettings();
  const test = useTestDnsNotification();
  const [state, setState] = useState<FormState>(() => toFormState(settings));
  const [notice, setNotice] = useState<string | null>(null);

  const isCloudflare = state.provider === 'cloudflare';

  function patch(next: Partial<FormState>): void {
    setState((current) => ({ ...current, ...next }));
    setNotice(null);
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
      gotifyAddress: state.gotifyAddress,
      ...extra,
    };
    if (state.cloudflareToken !== '') input.cloudflareToken = state.cloudflareToken;
    if (state.alibabaAccessKeySecret !== '') {
      input.alibabaAccessKeySecret = state.alibabaAccessKeySecret;
    }
    if (state.gotifyToken !== '') input.gotifyToken = state.gotifyToken;
    return input;
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    setNotice(null);
    save.mutate(buildUpdate(), {
      onSuccess: () => {
        setNotice('Settings saved.');
        // Empty the credential boxes: the server now holds those values, and
        // leaving them filled would make the next save look like a change.
        setState((current) => ({
          ...current,
          cloudflareToken: '',
          alibabaAccessKeySecret: '',
          gotifyToken: '',
        }));
      },
    });
  }

  function clear(flag: keyof UpdateDnsSettingsInput, label: string): void {
    save.mutate(buildUpdate({ [flag]: true }), {
      onSuccess: () => setNotice(`${label} cleared.`),
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Provider" hint="Only the selected provider's credentials are required.">
        {({ id }) => (
          <Select
            id={id}
            value={state.provider}
            onChange={(event) => patch({ provider: event.target.value as DnsProviderName })}
          >
            <option value="cloudflare">Cloudflare</option>
            <option value="alibaba">Alibaba Cloud</option>
          </Select>
        )}
      </Field>

      {isCloudflare ? (
        <>
          <SecretField
            label="Cloudflare API token"
            hint="Needs permission to edit DNS records in this zone."
            saved={settings?.hasCloudflareToken ?? false}
            value={state.cloudflareToken}
            onChange={(value) => patch({ cloudflareToken: value })}
            onClear={() => clear('clearCloudflareToken', 'Cloudflare API token')}
            required
            pending={save.isPending}
          />
          <Field label="Zone ID">
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
          <Field label="Record name" hint="The full name, e.g. home.example.com.">
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
          <Field label="Access key ID">
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
            label="Access key secret"
            saved={settings?.hasAlibabaAccessKeySecret ?? false}
            value={state.alibabaAccessKeySecret}
            onChange={(value) => patch({ alibabaAccessKeySecret: value })}
            onClear={() => clear('clearAlibabaAccessKeySecret', 'Alibaba Cloud access key secret')}
            required
            pending={save.isPending}
          />
          <Field
            label="Record ID"
            hint="Alibaba Cloud updates by record id and never creates one, so it has to exist already. Its host record and type come from the provider's own answer, not from here."
          >
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

      <div className="border-line grid gap-4 border-t pt-4">
        <Switch
          checked={state.scheduleEnabled}
          onChange={(checked) => patch({ scheduleEnabled: checked })}
          label="Check on a schedule"
        />
        <Field label="Interval (minutes)" hint="A check that finds the same address writes nothing.">
          {({ id }) => (
            <TextInput
              id={id}
              className="mono w-32"
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

      <div className="border-line grid gap-4 border-t pt-4">
        <Field label="Gotify address" hint="Optional. Sent only when a record actually changes.">
          {({ id }) => (
            <TextInput
              id={id}
              className="mono"
              value={state.gotifyAddress}
              placeholder="notify.example.com"
              onChange={(event) => patch({ gotifyAddress: event.target.value })}
            />
          )}
        </Field>
        <SecretField
          label="Gotify token"
          saved={settings?.hasGotifyToken ?? false}
          value={state.gotifyToken}
          onChange={(value) => patch({ gotifyToken: value })}
          onClear={() => clear('clearGotifyToken', 'Gotify token')}
          pending={save.isPending}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            icon={<Send className="size-4" aria-hidden />}
            loading={test.isPending}
            disabled={save.isPending}
            onClick={() =>
              test.mutate(
                { gotifyAddress: state.gotifyAddress, gotifyToken: state.gotifyToken },
                { onSuccess: () => setNotice('Test message sent.') },
              )
            }
          >
            Send test message
          </Button>
          <span className="text-faint text-meta">
            Uses what is in the boxes above, saved or not.
          </span>
        </div>
        {test.isError ? <ErrorBanner message={errorMessage(test.error)} /> : null}
      </div>

      {save.isError ? <ErrorBanner message={errorMessage(save.error)} /> : null}
      {notice === null ? null : <p className="text-ok text-meta">{notice}</p>}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          icon={<Save className="size-4" aria-hidden />}
          loading={save.isPending}
        >
          Save settings
        </Button>
      </div>
    </form>
  );
}

/**
 * A credential box, its stored-or-not marker, and its delete button.
 *
 * The delete button is disabled when nothing is stored, because the click is an
 * irreversible delete and a control that cannot do anything should not look like
 * it can. A credential the selected provider still needs stays disabled with a
 * reason -- and the server refuses that case too, so the disabled state is never
 * the only defence.
 */
function SecretField({
  label,
  hint,
  saved,
  value,
  onChange,
  onClear,
  required = false,
  pending,
}: {
  label: string;
  hint?: string;
  saved: boolean;
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  /** True when the *selected* provider cannot run without this credential. */
  required?: boolean;
  pending: boolean;
}) {
  const blocked = required && saved;

  return (
    <Field
      label={label}
      hint={hint}
      aside={
        <span className="flex items-center gap-2">
          <span className={saved ? 'text-ok text-meta' : 'text-faint text-meta'}>
            {saved ? 'Saved' : 'Not set'}
          </span>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" aria-hidden />}
            disabled={!saved || blocked || pending}
            title={
              blocked
                ? 'The selected provider still needs this credential.'
                : `Delete the stored ${label.toLowerCase()}`
            }
            onClick={onClear}
          >
            Clear
          </Button>
        </span>
      }
    >
      {({ id, describedBy }) => (
        <TextInput
          id={id}
          aria-describedby={describedBy}
          type="password"
          className="mono"
          autoComplete="new-password"
          value={value}
          placeholder={saved ? 'unchanged' : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}
