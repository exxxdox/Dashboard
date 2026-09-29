import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { IconButton } from './Button';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';

const SIZE_CLASS = {
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
} as const;

/**
 * A dialog, over the browser's own `<dialog>` element.
 *
 * `showModal()` is what makes this worth not hand-rolling: focus trapping, the
 * Esc key, the inert background and the top layer all come with it, and a
 * `div` with `position: fixed` has to reimplement every one of them -- and gets
 * the last one wrong. What is left here is the styling, and keeping `open` and
 * the element's own state from drifting apart.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: keyof typeof SIZE_CLASS;
  children: ReactNode;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Esc arrives as `cancel` rather than as a close, so it becomes the same
      // call the close button makes: one exit, one owner of `open`.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click on the backdrop targets the dialog element itself. The content
      // sits in the child below, so this cannot fire for a click inside it.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn('modal-panel card w-[calc(100vw-2rem)] p-0', SIZE_CLASS[size])}
    >
      <header className="border-line flex items-start justify-between gap-4 border-b px-5 py-4">
        <div className="grid min-w-0 gap-1">
          <h2 id={titleId} className="text-ink text-title font-semibold tracking-tight">
            {title}
          </h2>
          {description ? <p className="text-mute text-body">{description}</p> : null}
        </div>
        <IconButton label={t('common.close')} onClick={onClose}>
          <X className="size-[18px]" aria-hidden />
        </IconButton>
      </header>
      <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}
