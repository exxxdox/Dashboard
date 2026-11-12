import { useEffect, useState } from 'react';
import { ArrowUp, Folder, FolderCheck } from 'lucide-react';

import { useTargetDirectories } from '../api/queries';
import { errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { TextInput } from '../components/Form';
import { Modal } from '../components/Modal';
import { useI18n } from '../lib/i18n';

/**
 * Browse one target's directories and choose one as a run's working directory.
 *
 * The target has to be chosen first: the list is a fact only that host can
 * answer, so there is nothing to show before one is selected.
 */
export function WorkDirPicker({
  targetId,
  targetName,
  value,
  open,
  defaultPath,
  onClose,
  onSelect,
}: {
  targetId: string;
  targetName: string;
  /** The form's current value; blank opens at the target default. */
  value: string;
  open: boolean;
  defaultPath: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [path, setPath] = useState(defaultPath);

  // Opening starts from where the form currently points, not wherever the last
  // browsing session ended.
  useEffect(() => {
    if (open) setPath(value.trim().startsWith('/') ? value.trim() : defaultPath);
  }, [open, value, defaultPath]);

  const listing = useTargetDirectories(open ? targetId : null, path, open);
  const listingData = listing.data;
  const usable = path.startsWith('/');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('runs.workDir.browseTitle')}
      description={t('runs.workDir.browseHint', { target: targetName })}
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <label className="label" htmlFor="work-dir-path">
            {t('runs.workDir.pathLabel')}
          </label>
          <TextInput
            id="work-dir-path"
            className="mono"
            value={path}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setPath(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            icon={<ArrowUp className="size-4" aria-hidden />}
            disabled={!listingData?.parent}
            onClick={() => {
              if (listingData?.parent) setPath(listingData.parent);
            }}
          >
            {t('runs.workDir.up')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<FolderCheck className="size-4" aria-hidden />}
            disabled={!usable}
            onClick={() => {
              onSelect(path);
              onClose();
            }}
          >
            {t('runs.workDir.select')}
          </Button>
        </div>

        {!usable ? (
          <p className="text-danger text-meta">{t('runs.error.absolutePath')}</p>
        ) : listing.isPending ? (
          <p className="text-mute text-meta">{t('runs.workDir.loading')}</p>
        ) : listing.isError ? (
          <p className="text-danger text-meta">{errorMessage(listing.error, i18n)}</p>
        ) : listingData && listingData.entries.length === 0 ? (
          <p className="text-mute text-meta">{t('runs.workDir.empty')}</p>
        ) : (
          <ul className="divide-line border-line max-h-72 divide-y overflow-y-auto rounded-lg border">
            {listingData?.entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="focus-ring hover:bg-panel-2 flex w-full items-center gap-2 px-3 py-2 text-left"
                  onClick={() => setPath(entry.path)}
                >
                  <Folder className="text-accent size-4 shrink-0" aria-hidden />
                  <span className="mono min-w-0 truncate">{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
