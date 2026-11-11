// The package ships this type, but its exports map omits the declaration entry.
declare module '@fig/lezer-bash' {
  import type { LRLanguage } from '@codemirror/language';
  export const parser: LRLanguage['parser'];
}
