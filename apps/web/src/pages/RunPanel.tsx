import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  TARGET_TEMP_DIR,
  MAX_PARAM_COUNT,
  type ExecuteScriptInput,
  type ScriptParam,
  type ScriptSummary,
  type TargetSummary,
} from '@dashboard/shared';
import { ChevronRight, FolderOpen, Plus, Trash } from 'lucide-react';
import { Button, IconButton } from '../components/Button';
import { Select, Switch, TextInput } from '../components/Form';
import {
  useSaveScriptRunDraft,
  useScriptRunDraft,
  useTargets,
} from '../api/queries';
import { cn } from '../lib/cn';
import { useI18n } from '../lib/i18n';
import {
  describePrefill,
  draftFromForm,
  formFromDraft,
  sameDraft,
} from '../lib/run-draft';
import {
  addRow,
  isBlankRow,
  removeRow,
  updateRow,
  validateRows,
  validateValues,
  type CustomParamMode,
  type CustomParamRow,
} from '../lib/run-params';
import { toRunInput } from '../lib/run-submit';
import { WorkDirPicker } from './WorkDirPicker';

type ParamValues = Record<string, string>;

/**
 * How long the form waits after the last keystroke before storing its draft.
 * Long enough that typing a path is one request, short enough that closing the
 * tab right after a change still keeps it.
 */
const DRAFT_SAVE_DELAY_MS = 700;

type RunPanelProps = {
  script: ScriptSummary;
  mode?: 'run' | 'schedule';
  initialInput?: ExecuteScriptInput;
  /** Whether the run dialog is showing. Dismissing it flushes the draft. */
  active?: boolean;
  children?: (getInput: () => ExecuteScriptInput | null) => ReactNode;
};

/** A declared default is the value the form starts from. */
function seedValues(params: ScriptParam[]): ParamValues {
  const values: ParamValues = {};
  for (const param of params) {
    if (param.default !== null) values[param.name] = param.default;
    else if (param.type === 'bool') values[param.name] = '0';
  }
  return values;
}

/**
 * One label column, one control column, so every row here lines up whether the
 * control is a select, a text input or a switch. `Field` stacks its label above
 * the control, which reads well in a single-column form but not beside a list of
 * parameters whose labels are all the same kind of thing.
 */
function RunRow({
  label,
  meta,
  hint,
  error,
  children,
}: {
  label: string;
  /** What the script says about the parameter: type, requiredness, default. */
  meta?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode;
}) {
  const id = useId();
  const messageId = `${id}-message`;

  return (
    // Label and meta share the first line -- label left, meta right -- and the
    // control takes the next one at full width. The pane is 360px wide, so a
    // label column beside the control would leave the control about 120px and
    // wrap every hint; this way every control on the panel has the same two
    // edges, which is what makes the rows read as aligned.
    <div className="grid gap-1.5">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        {meta ? (
          <span className="mono text-faint text-micro text-right break-all">{meta}</span>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-1">
        {children({ id, describedBy: error || hint ? messageId : undefined })}
        {error ? (
          <p id={messageId} className="text-danger text-meta">
            {error}
          </p>
        ) : hint ? (
          <p id={messageId} className="text-mute text-meta">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One hand-added parameter. The mode is chosen first because it decides what the
 * two fields are called: `env` needs an environment variable name, `argv` only a
 * label for the operator. The inputs carry visible captions instead of relying on
 * placeholders, which disappear as soon as the row has content.
 */
export function CustomParamEditor({
  row,
  index,
  error,
  onChange,
  onRemove,
}: {
  row: CustomParamRow;
  index: number;
  error: string | undefined;
  onChange: (patch: Partial<Pick<CustomParamRow, 'name' | 'value' | 'mode'>>) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  // The row id is unique for the lifetime of the form; deriving the field ids
  // from it keeps them stable without another hook.
  const nameId = `custom-${row.id}-name`;
  const valueId = `custom-${row.id}-value`;
  const env = row.mode === 'env';

  return (
    <div className="border-line bg-panel-2/40 grid gap-2 rounded-lg border p-2.5">
      <div className="flex items-center gap-2">
        <Select
          className="min-w-0 flex-1"
          aria-label={t('runs.custom.modeLabel', { index: index + 1 })}
          value={row.mode}
          onChange={(event) => onChange({ mode: event.target.value as CustomParamMode })}
        >
          <option value="env">{t('runs.custom.modeEnv')}</option>
          <option value="argv">{t('runs.custom.modeArgv')}</option>
        </Select>
        <IconButton label={t('runs.custom.remove', { index: index + 1 })} onClick={onRemove}>
          <Trash className="size-4" aria-hidden />
        </IconButton>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
        <label className="text-mute text-meta" htmlFor={nameId}>
          {env ? t('runs.custom.name') : t('runs.custom.label')}
        </label>
        <TextInput
          id={nameId}
          className="mono min-w-0"
          placeholder={env ? 'NAME' : t('runs.custom.labelPlaceholder')}
          value={row.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <label className="text-mute text-meta" htmlFor={valueId}>
          {t('runs.custom.value')}
        </label>
        <TextInput
          id={valueId}
          className="mono min-w-0"
          placeholder={t('runs.custom.valuePlaceholder')}
          value={row.value}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      </div>
      {error ? <p className="text-danger text-meta">{error}</p> : null}
    </div>
  );
}

/**
 * The run form. Mount it with `key={script.id}`: a different script means a
 * different parameter set, and remounting is clearer than re-seeding state.
 */
export function RunPanel({ script, mode = 'run', initialInput, active = true, children }: RunPanelProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const targets = useTargets();
  const prefill = useScriptRunDraft(mode === 'run' ? script.id : null);
  const saveDraft = useSaveScriptRunDraft();

  // A plan edits its own saved invocation; the manual run draft is a separate document.
  const [initial] = useState(() => initialInput ? formFromDraft({
    params: initialInput.params,
    interactive: initialInput.interactive,
    workDir: initialInput.workDir ?? '',
    custom: initialInput.argv.map((value) => ({ name: '', value, mode: 'argv' as const })),
    timeoutSec: initialInput.timeoutSec === undefined ? '' : String(initialInput.timeoutSec),
  }, script.params) : null);
  const [interactive, setInteractive] = useState(initial?.interactive ?? false);
  const [targetId, setTargetId] = useState(initialInput?.targetId ?? '');
  const [workDir, setWorkDir] = useState(initial?.workDir ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [values, setValues] = useState<ParamValues>(() => initial?.values ?? seedValues(script.params));
  const [timeout, setTimeoutSec] = useState(initial?.timeoutSec ?? '');
  const [showErrors, setShowErrors] = useState(false);
  // Whether the operator has touched the form since it opened. Nothing is saved
  // until they have, so merely opening a script does not rewrite its draft.
  const [touched, setTouched] = useState(false);

  // A script that declares nothing has no other way in, so the list that can
  // carry anything starts open; with declared parameters above it, it stays out
  // of the way until asked for.
  const [customOpen, setCustomOpen] = useState(script.params.length === 0 || Boolean(initial?.rows.length));
  const [customRows, setCustomRows] = useState<CustomParamRow[]>(initial?.rows ?? []);

  // Every edit marks the form dirty; the seed above deliberately does not, or
  // opening a script would count as typing in it.
  function editValues(next: (current: ParamValues) => ParamValues): void {
    setTouched(true);
    setValues(next);
  }

  function editRows(next: (current: CustomParamRow[]) => CustomParamRow[]): void {
    setTouched(true);
    setCustomRows(next);
  }

  function editTimeout(next: string): void {
    setTouched(true);
    setTimeoutSec(next);
  }

  const errors = validateValues(script.params, values, t);
  const customErrors = validateRows(customRows, script.params, t);
  // A blank directory is the target's default; anything else must be absolute.
  const workDirError =
    workDir.trim() !== '' && !workDir.trim().startsWith('/') ? t('runs.error.absolutePath') : null;
  const hasErrors =
    Object.keys(errors).length > 0 || Object.keys(customErrors).length > 0 || workDirError !== null;
  // The run dialog has no submit button, so `showErrors` alone would never flip
  // in run mode: a touched form reveals its errors, and the schedule editor's
  // save still turns them all on.
  const revealErrors = showErrors || touched;

  const targetList = targets.data ?? [];
  // Defaulting to the first target keeps the common single-host setup to one click.
  const effectiveTargetId = targetId || targetList[0]?.id || '';
  const selectedTarget: TargetSummary | undefined = targetList.find(
    (target) => target.id === effectiveTargetId,
  );
  const noTargets = targets.isSuccess && targetList.length === 0;
  const atCap = customRows.length >= MAX_PARAM_COUNT;

  function appendRow(): void {
    // The id comes from the rows themselves, so two clicks in one batch still
    // produce two distinct rows.
    editRows(addRow);
  }

  // Only the schedule editor reads the form through this. Manual runs go through
  // the identity bar's run button, which reads the same saved draft.
  function currentInput(): ExecuteScriptInput | null {
    setShowErrors(true);
    if (hasErrors || effectiveTargetId === '') return null;
    return toRunInput({
      values,
      rows: customRows,
      timeoutSec: timeout,
      workDir,
      interactive: mode === 'run' && interactive,
    }, effectiveTargetId);
  }

  // The draft arrives once per script; it seeds the form and then stops being
  // authoritative, so typing is never overwritten by a late response.
  const [seeded, setSeeded] = useState(false);
  if (mode === 'run' && prefill.data && !seeded) {
    setSeeded(true);
    // A slow prefill must not replace edits made while the request was pending.
    if (!touched) {
      const restored = formFromDraft(prefill.data.draft, script.params);
      setInteractive(restored.interactive ?? false);
      setValues(restored.values);
      setCustomRows(restored.rows);
      setWorkDir(restored.workDir ?? '');
      if (restored.timeoutSec !== '') setTimeoutSec(restored.timeoutSec);
      setCustomOpen(script.params.length === 0 || restored.rows.length > 0);
    }
  }

  // Save as they type, without a button: debounced rather than a request per
  // keystroke, skipped when nothing changed, and only once they have touched
  // something -- opening a script must not rewrite its draft.
  const savedDraft = prefill.data?.draft;
  const save = saveDraft.mutateAsync;
  const draft = draftFromForm({ values, rows: customRows, timeoutSec: timeout, workDir, interactive });
  const lastRequested = useRef('');
  const saveQueue = useRef<Promise<unknown> | null>(null);
  const serialized = JSON.stringify(draft);
  // Compare against queued writes too, so reverting an in-flight edit is saved.
  function hasUnsavedDraft(): boolean {
    return mode === 'run' && touched && (lastRequested.current
      ? lastRequested.current !== serialized
      : !savedDraft || !sameDraft(savedDraft, draft));
  }
  const dirty = hasUnsavedDraft();
  const flushRef = useRef<() => void>(() => undefined);
  function flushDraft(): void {
    // Failure clears the ref without a render; check its current value at flush.
    if (!hasUnsavedDraft()) return;
    lastRequested.current = serialized;
    // Preserve edit order even when an earlier save is still in flight at close.
    const request = () => save({ id: script.id, draft });
    saveQueue.current = (saveQueue.current ? saveQueue.current.then(request) : request()).catch(() => {
      // A failed background write must remain retryable on submit or close.
      if (lastRequested.current === serialized) lastRequested.current = '';
    });
  }
  flushRef.current = flushDraft;

  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => flushRef.current(), DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dirty, values, customRows, timeout, workDir]);

  // Only unmount flushes immediately; ordinary edits still share the debounce.
  useEffect(() => () => flushRef.current(), []);

  // The dialog stays mounted while closed, so unmount is not the only way out:
  // dismissing it must store the last edit before the run button reads the draft.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) flushRef.current();
    wasActive.current = active;
  }, [active]);

  const restoredNotice = mode === 'run' && prefill.data ? describePrefill(prefill.data) : null;
  // Counts every row that will be sent, not every row with a name: an argument
  // row usually has no label, and a badge that said 1 for three rows would be
  // worse than no badge.
  const customCount = customRows.filter((row) => !isBlankRow(row)).length;

  return (
    <div className="grid gap-4">
      <div className="border-line grid gap-3 border-t pt-4">
        {/* Says why the form is already filled in. Without it, restored values
            are indistinguishable from declared defaults. */}
        {restoredNotice ? (
          <p className="text-faint text-micro">{t(restoredNotice)}</p>
        ) : null}

        <RunRow
          label={t('runs.field.target')}
          hint={
            selectedTarget
              ? `${selectedTarget.username}@${selectedTarget.host}:${selectedTarget.port}`
              : undefined
          }
          error={showErrors && effectiveTargetId === '' ? t('runs.error.pickTarget') : null}
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={effectiveTargetId}
              disabled={noTargets || targets.isPending}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {targets.isPending ? <option value="">{t('runs.target.loading')}</option> : null}
              {noTargets ? <option value="">{t('runs.target.none')}</option> : null}
              {targetList.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name} — {target.username}@{target.host}
                </option>
              ))}
            </Select>
          )}
        </RunRow>

        <RunRow
          label={t('runs.field.workDir')}
          hint={
            selectedTarget
              ? t('runs.workDir.hint')
              : t('runs.workDir.targetFirst')
          }
          error={revealErrors ? workDirError : null}
        >
          {({ id, describedBy }) => (
            <div className="flex min-w-0 items-center gap-2">
              <TextInput
                id={id}
                aria-describedby={describedBy}
                className="mono min-w-0 flex-1"
                value={workDir}
                spellCheck={false}
                autoComplete="off"
                disabled={!selectedTarget}
                onChange={(event) => {
                  setTouched(true);
                  setWorkDir(event.target.value);
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<FolderOpen className="size-4" aria-hidden />}
                disabled={!selectedTarget}
                title={selectedTarget ? t('runs.workDir.browse') : t('runs.workDir.targetFirst')}
                onClick={() => setPickerOpen(true)}
              >
                {t('runs.workDir.browse')}
              </Button>
            </div>
          )}
        </RunRow>

        {mode === 'run' ? (
          // A titled row: the switch alone read as an unlabeled control, and the
          // hint below it explained the effect without ever naming it.
          <RunRow label={t('runs.interactive.label')} hint={t('runs.interactive.hint')}>
            {({ id }) => (
              <Switch
                id={id}
                label={t('runs.interactive.label')}
                checked={interactive}
                onChange={(checked) => { setTouched(true); setInteractive(checked); }}
              />
            )}
          </RunRow>
        ) : null}

        {noTargets ? (
          <p className="text-mute text-meta">
            {t('runs.noTargets.lead')}{' '}
            <a href="#/targets" className="text-accent underline underline-offset-2">
              {t('runs.noTargets.link')}
            </a>{' '}
            {t('runs.noTargets.tail')}
          </p>
        ) : null}

        {script.params.length > 0 ? (
          <>
            <p className="label border-line mt-1 border-t pt-4">{t('runs.field.parameters')}</p>
            {script.params.map((param) => (
              <RunRow
                key={param.name}
                label={param.name}
                meta={`${param.type}${param.required ? ` · ${t('runs.param.required')}` : ''}${
                  param.default !== null
                    ? ` · ${t('runs.param.default', { value: param.default })}`
                    : ''
                }`}
                hint={param.description || undefined}
                error={revealErrors ? (errors[param.name] ?? null) : null}
              >
                {({ id, describedBy }) =>
                  param.type === 'bool' ? (
                    // The row's label already names the parameter; the switch
                    // carries it only for screen readers, and no visible text.
                    <Switch
                      id={id}
                      label={param.name}
                      checked={(values[param.name] ?? '0') === '1'}
                      onChange={(checked) =>
                        editValues((current) => ({ ...current, [param.name]: checked ? '1' : '0' }))
                      }
                    />
                  ) : (
                    <TextInput
                      id={id}
                      aria-describedby={describedBy}
                      type={param.type === 'number' ? 'number' : 'text'}
                      className="mono"
                      value={values[param.name] ?? ''}
                      placeholder={param.default ?? ''}
                      onChange={(event) =>
                        editValues((current) => ({ ...current, [param.name]: event.target.value }))
                      }
                    />
                  )
                }
              </RunRow>
            ))}
          </>
        ) : (
          <p className="text-mute text-meta">{t('runs.noParams')}</p>
        )}

        <div className="border-line mt-1 grid gap-3 border-t pt-4">
          <button
            type="button"
            aria-expanded={customOpen}
            onClick={() => setCustomOpen((open) => !open)}
            className="focus-ring -mx-1 flex items-center gap-2 rounded-lg px-1 py-0.5 text-left"
          >
            <ChevronRight
              className={cn(
                'text-faint size-4 shrink-0 transition-transform duration-150 ease-out',
                customOpen && 'rotate-90',
              )}
              aria-hidden
            />
            <span className="label">{t('runs.custom.title')}</span>
            {customCount > 0 ? (
              <span className="mono text-accent text-micro">{customCount}</span>
            ) : null}
          </button>

          {customOpen ? (
            <div className="grid gap-2">
              {customRows.map((row, index) => (
                <CustomParamEditor
                  key={row.id}
                  row={row}
                  index={index}
                  // Shown as soon as the row is non-blank, not on submit: the
                  // mistakes here are typos the operator can see and fix, and a
                  // blank row reports nothing.
                  error={customErrors[row.id]}
                  onChange={(patch) =>
                    editRows((current) => updateRow(current, row.id, patch))
                  }
                  onRemove={() => editRows((current) => removeRow(current, row.id))}
                />
              ))}

              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus className="size-4" aria-hidden />}
                  disabled={atCap}
                  onClick={appendRow}
                >
                  {t('runs.custom.add')}
                </Button>
              </div>

              <p className="text-faint text-meta">
                <span className="mono">env</span> {t('runs.custom.envLead')}{' '}
                <span className="mono">SD_*</span> {t('runs.custom.envTail')}{' '}
                <span className="mono">argv</span> {t('runs.custom.argvLead')}{' '}
                <span className="mono">$1</span>, <span className="mono">$2</span> …{' '}
                {t('runs.custom.argvTail', { max: MAX_PARAM_COUNT })}
              </p>
            </div>
          ) : null}
        </div>

        <RunRow
          label={t('runs.field.timeout')}
          hint={
            script.timeoutSec === null
              ? t('runs.timeout.hint')
              : t('runs.timeout.hintOwn', { seconds: script.timeoutSec })
          }
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              type="number"
              min={1}
              max={86_400}
              className="mono w-32"
              value={timeout}
              placeholder={script.timeoutSec === null ? '' : String(script.timeoutSec)}
              onChange={(event) => editTimeout(event.target.value)}
            />
          )}
        </RunRow>
      </div>

      <WorkDirPicker
        targetId={effectiveTargetId}
        targetName={selectedTarget?.name ?? ''}
        value={workDir}
        open={pickerOpen && selectedTarget !== undefined}
        defaultPath={TARGET_TEMP_DIR}
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => {
          setTouched(true);
          setWorkDir(path);
        }}
      />

      {children?.(currentInput)}
    </div>
  );
}
