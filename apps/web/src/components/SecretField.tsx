import { Trash2 } from 'lucide-react';

import { Button } from './Button';
import { Field, TextInput } from './Form';
import { useT } from '../lib/i18n';

/**
 * A credential box, its stored-or-not marker, and its delete button.
 *
 * Extracted because two features store a credential now, and the rule they
 * share is easy to get subtly wrong in a second copy: the API never returns a
 * credential, so an empty box means "keep what is stored" and deleting has to
 * be its own button. Without the marker beside it, empty and never-set look
 * identical.
 *
 * The delete button is disabled when nothing is stored, because the click is an
 * irreversible delete and a control that cannot do anything should not look
 * like it can. A credential the configuration still needs stays disabled with a
 * reason -- and the server refuses that case too, so the disabled state is
 * never the only defence.
 */
export function SecretField({
  label,
  hint,
  saved,
  value,
  onChange,
  onClear,
  blockedReason,
  pending,
}: {
  label: string;
  hint?: string;
  saved: boolean;
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  /** Set when the stored credential is still required, so clearing is refused. */
  blockedReason?: string;
  pending: boolean;
}) {
  const t = useT();
  const blocked = blockedReason !== undefined && saved;

  return (
    <Field
      label={label}
      hint={hint}
      aside={
        <span className="flex items-center gap-2">
          <span className={saved ? 'text-ok text-meta' : 'text-faint text-meta'}>
            {saved ? t('common.saved') : t('common.notSet')}
          </span>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" aria-hidden />}
            disabled={!saved || blocked || pending}
            title={blocked ? blockedReason : t('common.deleteNamed', { name: label })}
            onClick={onClear}
          >
            {t('common.clear')}
          </Button>
        </span>
      }
    >
      {({ id, describedBy }) => (
        <TextInput
          id={id}
          aria-describedby={describedBy}
          type="password"
          className="mono"
          autoComplete="new-password"
          value={value}
          placeholder={saved ? t('common.unchanged') : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}
