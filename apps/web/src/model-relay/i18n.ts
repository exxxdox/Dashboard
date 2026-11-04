import { useCallback } from 'react';
import { useI18n, type Locale } from '../lib/i18n';
import english from './translations.json';

/** The source text stays Chinese so imported forms retain their original wording. */
export function translateRelayText(text: string, values: readonly unknown[] = [], locale: Locale = 'zh'): string {
  const translated = locale === 'en' ? (english as Record<string, string>)[text] ?? text : text;
  return translated.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ''));
}

export function relayText(text: string, values: readonly unknown[] = []): string {
  const locale = typeof document !== 'undefined' && document.documentElement.lang.startsWith('en') ? 'en' : 'zh';
  return translateRelayText(text, values, locale);
}

export function useRelayT(): typeof relayText {
  const { locale } = useI18n();
  return useCallback((text, values) => translateRelayText(text, values, locale), [locale]);
}
