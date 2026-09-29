/**
 * The dashboard's own preferences.
 *
 * A page rather than a dialog: these are settings someone returns to, links to,
 * and expects to find at a URL. Each section is a card and each card answers one
 * question -- which language, and where a notification goes -- so a third one
 * can be added without reflowing the first two.
 */

import { BellRing, Check } from 'lucide-react';

import { PageBody } from '../components/AppShell';
import { ErrorBanner, LoadingBlock } from '../components/Feedback';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { errorMessage } from '../api/client';
import { useAppSettings } from '../api/queries';
import { cn } from '../lib/cn';
import { useI18n, type Locale } from '../lib/i18n';
import { NotificationSettingsForm } from './NotificationSettingsForm';

export function SettingsPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const settings = useAppSettings();

  return (
    <PageBody>
      <PageHeader
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        description={t('settings.description')}
      />

      <div className="mt-5 grid gap-4">
        <Panel title={t('settings.language.title')}>
          <div className="grid gap-4">
            <p className="text-mute text-body max-w-2xl">{t('settings.language.description')}</p>
            <LanguagePicker />
          </div>
        </Panel>

        <Panel
          title={t('settings.notifications.title')}
          aside={<BellRing className="text-faint size-5" aria-hidden />}
        >
          <div className="grid gap-5">
            <p className="text-mute text-body max-w-2xl">
              {t('settings.notifications.description')}
            </p>
            {settings.isError ? (
              <ErrorBanner
                message={errorMessage(settings.error, i18n)}
                onRetry={() => void settings.refetch()}
              />
            ) : settings.isPending || !settings.data ? (
              <LoadingBlock label={t('common.loading')} />
            ) : (
              /* Remounted whenever the stored settings change, so the form's
                 one-shot seed of its fields cannot go stale. */
              <NotificationSettingsForm
                key={settings.data.updatedAt ?? 'new'}
                settings={settings.data}
              />
            )}
          </div>
        </Panel>
      </div>
    </PageBody>
  );
}

type LanguageOption = {
  value: Locale;
  /** A glyph from that script, so the choice reads at a glance. */
  glyph: string;
  /**
   * The endonym, deliberately not in the dictionary.
   *
   * A language names itself: someone who cannot read Chinese still recognises
   * 简体中文, and someone who cannot read English still recognises English.
   * Translating either would defeat the only thing this label is for.
   */
  name: string;
};

const LANGUAGES: LanguageOption[] = [
  { value: 'en', glyph: 'A', name: 'English' },
  { value: 'zh', glyph: '永', name: '简体中文' },
];

/**
 * Two cards instead of a select.
 *
 * A language is a choice with exactly two answers and no default worth hiding,
 * so showing both -- each in its own script and with a glyph from it -- makes
 * the alternative visible without opening anything.
 */
function LanguagePicker() {
  const { t, locale, setLocale } = useI18n();

  return (
    <div
      role="radiogroup"
      aria-label={t('settings.language.switch')}
      className="grid gap-3 sm:max-w-xl sm:grid-cols-2"
    >
      {LANGUAGES.map((option) => {
        const active = option.value === locale;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setLocale(option.value)}
            className={cn(
              'focus-ring flex items-center gap-4 rounded-xl border px-4 py-3.5 text-left',
              'transition-all duration-150 ease-out',
              active
                ? 'border-accent/55 bg-accent-soft shadow-card'
                : 'border-line bg-panel-2 hover:border-line-strong hover:bg-panel-3',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-lg text-xl font-semibold',
                active ? 'bg-accent text-accent-ink' : 'bg-panel-3 text-mute',
              )}
            >
              {option.glyph}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className={cn('text-lead font-semibold', active ? 'text-ink' : 'text-mute')}>
                {option.name}
              </span>
              {active ? (
                <span className="text-accent ml-auto flex items-center gap-1.5 text-meta">
                  <Check className="size-4" aria-hidden />
                  {t('settings.language.active')}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
