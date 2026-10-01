/**
 * Two languages, one dictionary per area.
 *
 * Written by hand rather than pulled from a library, for the same reason the
 * router is: the whole of what this needs is a lookup, an interpolation and a
 * `useState`, and a dependency would bring a plugin system, a backend loader
 * and a pluralisation format this app has no strings for.
 *
 * The shape that matters is the one that catches mistakes:
 *
 *   - Each area file declares `en` as a literal and `zh` as a
 *     `Record<keyof typeof en, string>`, so a key added to one language and not
 *     the other fails to compile. A missing translation is not a runtime
 *     fallback nobody notices; it is a build error.
 *   - `MessageKey` is the union of every area's keys, so `t('dns.titel')` is a
 *     type error rather than a screen with `dns.titel` printed on it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { authMessages } from './areas/auth';
import { commonMessages } from './areas/common';
import { dnsMessages } from './areas/dns';
import { errorMessages } from './areas/errors';
import { overviewMessages } from './areas/overview';
import { runsMessages } from './areas/runs';
import { scriptsMessages } from './areas/scripts';
import { settingsMessages } from './areas/settings';
import { sourcesMessages } from './areas/sources';
import { targetsMessages } from './areas/targets';
import { toastMessages } from './areas/toast';

export type Locale = 'en' | 'zh';

/** One area's strings: the English is the source, the Chinese mirrors its keys. */
export type MessageArea = {
  en: Record<string, string>;
  zh: Record<string, string>;
};

const AREAS = {
  common: commonMessages,
  errors: errorMessages,
  dns: dnsMessages,
  settings: settingsMessages,
  scripts: scriptsMessages,
  runs: runsMessages,
  targets: targetsMessages,
  sources: sourcesMessages,
  overview: overviewMessages,
  auth: authMessages,
  toast: toastMessages,
} satisfies Record<string, MessageArea>;

export type MessageKey = {
  [A in keyof typeof AREAS]: keyof (typeof AREAS)[A]['en'];
}[keyof typeof AREAS];

type Dictionary = Partial<Record<string, string>>;

/**
 * Parameters are substituted by name, not by position: `{count} files` stays
 * readable in a translator's hands, and a reordered sentence cannot silently
 * swap two values.
 *
 * An array value is a list of identifiers rather than of words -- the DNS
 * settings problem names the credential fields it is missing. Each one is
 * looked up as `error.field.<id>`, which is what lets the server send
 * `cloudflareZoneId` and the screen show a translated field name.
 */
export type MessageParams = Record<string, string | number | readonly string[]>;

/** A list in a sentence is punctuated the way the language punctuates lists. */
const SEPARATOR: Record<Locale, string> = { en: ', ', zh: '、' };

function lookup(locale: Locale, key: string): string | undefined {
  for (const area of Object.values(AREAS)) {
    const hit = (area[locale] as Dictionary)[key];
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function interpolate(
  template: string,
  params: MessageParams | undefined,
  locale: Locale,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    if (Array.isArray(value)) {
      return value
        .map((item) => lookup(locale, `error.field.${item}`) ?? item)
        .join(SEPARATOR[locale]);
    }
    return String(value);
  });
}

/**
 * A key this code did not choose, in the given language.
 *
 * Null says the dictionary has no such key, which is an ordinary answer rather
 * than a failure: the server names its own messages, and most of them are shown
 * exactly as they arrived.
 *
 * Shared by the React context below and by `globalLookup`, so "how a message is
 * resolved" has one definition rather than two that drift.
 */
function resolve(locale: Locale, key: string, params?: MessageParams): string | null {
  const template = lookup(locale, key) ?? lookup('en', key);
  return template === undefined ? null : interpolate(template, params, locale);
}

/**
 * A message in the given language.
 *
 * Falls back to English and then to the key itself. The key as a last resort is
 * deliberate: it is ugly and greppable, which is what you want from a string
 * nothing has a translation for.
 */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  return resolve(locale, key, params) ?? key;
}

const STORAGE_KEY = 'dashboard.locale';

/**
 * The language to open in.
 *
 * The browser's own preference, because the server has no idea who is asking
 * and this is a page served to whoever reaches it. Anything not recognisably
 * Chinese gets English, which is the safer wrong answer: a Chinese speaker
 * reads English more often than the reverse.
 */
function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'en' || stored === 'zh' ? stored : null;
  } catch {
    // Storage can be unavailable in a private window; the detected default is
    // then used for the session, which is a fine outcome.
    return null;
  }
}

/**
 * The language, for code that runs with no component to read a hook from.
 *
 * `api/query-client.ts` turns every settled mutation into a toast, and a toast
 * is built the moment the request answers -- there is no render to hang a
 * `useT` off. The provider keeps this in step with its own state, so
 * `globalTranslate` and `useT` cannot disagree for longer than one effect.
 */
let activeLocale: Locale = 'en';

/** Where the provider publishes the current language. */
export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

export function globalTranslate(key: MessageKey, params?: MessageParams): string {
  return translate(activeLocale, key, params);
}

export function globalLookup(key: string, params?: MessageParams): string | null {
  return resolve(activeLocale, key, params);
}

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: MessageKey, params?: MessageParams) => string;
  /**
   * The same lookup, for a key this code did not choose.
   *
   * A server error names its own message, so the compiler cannot know whether
   * the key exists. Null says it does not -- which is an ordinary answer here,
   * not a failure: most server messages have no wording in this dictionary and
   * are shown exactly as the server sent them.
   */
  lookup: (key: string, params?: MessageParams) => string | null;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale() ?? detectLocale());

  useEffect(() => {
    // The document's own language, so the browser hyphenates, spell-checks and
    // picks a font for the right script.
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    // Anything built outside a render reads the language from here.
    setActiveLocale(locale);
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Not remembering the choice is survivable; failing to render is not.
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      lookup: (key, params) => resolve(locale, key, params),
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

function useLocaleContext(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useT was called outside LocaleProvider');
  return value;
}

/** The translator. Every user-visible string in the app comes through here. */
export function useT(): LocaleContextValue['t'] {
  return useLocaleContext().t;
}

/**
 * Both halves at once, which is what most pages want: the translator for the
 * words, and the locale for the dates. A page that formatted a date with only
 * `t` would put an English month in a Chinese sentence.
 */
export function useI18n(): LocaleContextValue {
  return useLocaleContext();
}

/**
 * A translator, as a value rather than a hook.
 *
 * `lib/format.ts` is a plain module -- no React in it -- so it takes one of
 * these rather than calling a hook of its own.
 */
export type Translate = LocaleContextValue['t'];

/** What `errorMessage` needs, which is less than a whole translator. */
export type ErrorTranslator = Pick<LocaleContextValue, 'lookup'>;
