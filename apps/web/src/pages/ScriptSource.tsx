import type { ScriptFormat } from '@dashboard/shared';
import { BashEditor } from '../components/BashEditor';
import { useT } from '../lib/i18n';

const MAX_LINES = 400;

export function ScriptSource({ content, format }: { content: string; format: ScriptFormat }) {
  const t = useT();
  const lines = content.split(/\r?\n/);
  // The preview remains bounded, while the edit dialog loads the complete file separately.
  return (
    <div className="grid gap-2">
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
