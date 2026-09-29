import type { ScriptSummary } from '@dashboard/shared';
import { MonoValue } from '../components/MonoValue';
import { Modal } from '../components/Modal';
import { Stat } from '../components/Panel';
import { useI18n } from '../lib/i18n';
import { formatBytes, formatDateTime } from '../lib/format';
import { RunPanel } from './RunPanel';
import { ScriptMetadataForm } from './ScriptMetadataForm';

/** The three things a script's identity bar can open. */
export type ScriptDialog = 'facts' | 'metadata' | 'run';

/**
 * What the selected script is, what it records about itself, and how it runs.
 *
 * All three are dialogs rather than panels for one reason: the source is what
 * someone opens this page to read, and the panels holding these had taken over
 * half of it. They are mounted whether or not they are open -- the `<dialog>`
 * element stays in the document and `showModal()` is what shows it -- so the run
 * form keeps its state and its pending draft save while the dialog is closed.
 */
export function ScriptDialogs({
  script,
  open,
  onClose,
}: {
  script: ScriptSummary;
  /** Which dialog is open, or null for none. */
  open: ScriptDialog | null;
  onClose: () => void;
}) {
  const i18n = useI18n();

  return (
    <>
      <Modal
        open={open === 'facts'}
        onClose={onClose}
        title={i18n.t('scripts.panel.facts')}
        description={i18n.t('scripts.dialog.facts.description')}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Stat label={i18n.t('scripts.field.format')}>{script.format}</Stat>
          <Stat label={i18n.t('scripts.field.size')}>{formatBytes(script.sizeBytes)}</Stat>
          <Stat label={i18n.t('scripts.field.interpreter')}>
            {script.interpreterOverride === null
              ? i18n.t('scripts.auto')
              : script.interpreterOverride.join(' ')}
          </Stat>
          <Stat label={i18n.t('scripts.field.timeout')}>
            {script.timeoutSec === null ? i18n.t('common.notSet') : `${script.timeoutSec}s`}
          </Stat>
          <Stat label={i18n.t('scripts.field.sourcePath')} className="col-span-2">
            <MonoValue value={script.relPath} wrap />
          </Stat>
          <Stat label={i18n.t('scripts.field.discovered')} className="col-span-2" mono={false}>
            {formatDateTime(script.discoveredAt, i18n.locale)}
          </Stat>
          <Stat label={i18n.t('scripts.field.contentHash')} className="col-span-2">
            <MonoValue value={script.contentHash} wrap />
          </Stat>
        </div>
      </Modal>

      <Modal
        open={open === 'metadata'}
        onClose={onClose}
        title={i18n.t('scripts.panel.metadata')}
        description={i18n.t('scripts.dialog.metadata.description')}
      >
        {/* Keyed by id so opening it on another script reseeds the fields rather
            than showing the previous script's name in them. */}
        <ScriptMetadataForm key={script.id} script={script} />
      </Modal>

      <Modal
        open={open === 'run'}
        onClose={onClose}
        title={i18n.t('scripts.panel.run')}
        description={i18n.t('scripts.dialog.run.description')}
      >
        <RunPanel key={script.id} script={script} />
      </Modal>
    </>
  );
}
