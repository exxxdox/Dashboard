import type { ScriptFormat } from '@dashboard/shared';
import { BashEditor } from '../components/BashEditor';
import { useT } from '../lib/i18n';

const MAX_LINES = 400;

export function ScriptSource({ content, format }: { content: string; format: ScriptFormat }) {
  const t = useT();
  const lines = content.split(/\r?\n/);
  // The preview remains bounded, while the edit dialog loads the complete file separately.
  return (
    // CodeMirror's unlayered theme caps dialog editors; override it only in the full-height preview.
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2 [&_.cm-editor]:h-full [&_.cm-scroller]:max-h-none!">
      <BashEditor value={lines.slice(0, MAX_LINES).join('\n')} label={t('scripts.panel.source')} readOnly />
      <p className="text-faint text-micro">
        <span className="mono">{format}</span>
        {' · '}
        {lines.length > MAX_LINES
          ? t('scripts.source.overflow', { shown: MAX_LINES, total: lines.length })
          : t('scripts.source.lines', { count: lines.length })}
      </p>
    </div>
  );
}
