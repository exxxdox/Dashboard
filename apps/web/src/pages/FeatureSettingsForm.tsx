import type { AppSettingsView } from '@dashboard/shared';
import { Switch } from '../components/Form';
import { useSaveAppSettings } from '../api/queries';
import { useT } from '../lib/i18n';

export function FeatureSettingsForm({ settings }: {
  settings: Pick<AppSettingsView, 'dnsEnabled' | 'modelRelayEnabled'>;
}) {
  const t = useT();
  const save = useSaveAppSettings();

  // Save only the changed flag so unrelated settings and credentials stay current.
  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="label">{t('nav.dns')}</p>
          <p className="text-mute text-meta mt-1">{t('settings.features.dnsHint')}</p>
        </div>
        <Switch label={t('nav.dns')} checked={settings.dnsEnabled}
          onChange={(dnsEnabled) => save.mutate({ dnsEnabled })} disabled={save.isPending} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="label">{t('nav.modelRelay')}</p>
          <p className="text-mute text-meta mt-1">{t('settings.features.modelRelayHint')}</p>
        </div>
        <Switch label={t('nav.modelRelay')} checked={settings.modelRelayEnabled}
          onChange={(modelRelayEnabled) => save.mutate({ modelRelayEnabled })} disabled={save.isPending} />
      </div>
    </div>
  );
}
