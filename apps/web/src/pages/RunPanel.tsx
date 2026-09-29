import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  MAX_PARAM_COUNT,
  type ScriptParam,
  type ScriptSummary,
  type TargetSummary,
} from '@script-dashboard/shared';
import { ChevronRight, Play, Plus, Trash } from 'lucide-react';
import { Button, IconButton } from '../components/Button';
import { ErrorBanner } from '../components/Feedback';
import { Select, Switch, TextInput } from '../components/Form';
import {
  useExecuteScript,
  useSaveScriptRunDraft,
  useScriptRunDraft,
  useTargets,
} from '../api/queries';
import { errorMessage } from '../api/client';
import { cn } from '../lib/cn';
import { navigate } from '../lib/router';
import {
  describePrefill,
  draftFromForm,
  formFromDraft,
  sameDraft,
} from '../lib/run-draft';
import {
  addRow,
  collectArgv,
  collectParams,
  isBlankRow,
  removeRow,
  updateRow,
  validateRows,
  type CustomParamMode,
  type CustomParamRow,
} from '../lib/run-params';

type ParamValues = Record<string, string>;

/**
 * How long the form waits after the last keystroke before storing its draft.
 * Long enough that typing a path is one request, short enough that closing the
 * tab right after a change still keeps it.
 */
const DRAFT_SAVE_DELAY_MS = 700;

type RunPanelProps = {
  script: ScriptSummary;
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
 * Client-side mirror of the server's own `validateParams`, so a missing
 * required value is caught before a request is made. The server stays the
 * authority: this only saves a round trip.
 */
function validate(params: ScriptParam[], values: ParamValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const param of params) {
    const raw = (values[param.name] ?? '').trim();
    if (raw === '') {
      if (param.required && param.default === null) errors[param.name] = 'Required';
      continue;
    }
    if (param.type === 'number' && !Number.isFinite(Number(raw))) {
      errors[param.name] = 'Expected a number';
    }
  }
  return errors;
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
 * The run form. Mount it with `key={script.id}`: a different script means a
 * different parameter set, and remounting is clearer than re-seeding state.
 */
export function RunPanel({ script }: RunPanelProps) {
  const targets = useTargets();
  const execute = useExecuteScript();
  const prefill = useScriptRunDraft(script.id);
  const saveDraft = useSaveScriptRunDraft();

  const [targetId, setTargetId] = useState('');
  const [values, setValues] = useState<ParamValues>(() => seedValues(script.params));
  const [timeout, setTimeoutSec] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  // Whether the operator has touched the form since it opened. Nothing is saved
  // until they have, so merely opening a script does not rewrite its draft.
  const [touched, setTouched] = useState(false);

  // A script that declares nothing has no other way in, so the list that can
  // carry anything starts open; with declared parameters above it, it stays out
  // of the way until asked for.
  const [customOpen, setCustomOpen] = useState(script.params.length === 0);
  const [customRows, setCustomRows] = useState<CustomParamRow[]>([]);

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

  const errors = validate(script.params, values);
  const customErrors = validateRows(customRows, script.params);
  const hasErrors = Object.keys(errors).length > 0 || Object.keys(customErrors).length > 0;

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

  function submit(): void {
    setShowErrors(true);
    if (hasErrors || effectiveTargetId === '') return;

    execute.mutate(
      {
        scriptId: script.id,
        input: {
          targetId: effectiveTargetId,
          // Custom rows cannot collide with a declared name: validateRows
          // refuses a row that repeats one.
          params: { ...values, ...collectParams(customRows) },
          argv: collectArgv(customRows),
          ...(timeout.trim() === '' ? {} : { timeoutSec: Number(timeout) }),
        },
      },
      { onSuccess: (result) => navigate(`/runs/${encodeURIComponent(result.executionId)}`) },
    );
  }

  // The draft arrives once per script; it seeds the form and then stops being
  // authoritative, so typing is never overwritten by a late response.
  const [seeded, setSeeded] = useState(false);
  if (prefill.data && !seeded) {
    setSeeded(true);
    const restored = formFromDraft(prefill.data.draft, script.params);
    setValues(restored.values);
    setCustomRows(restored.rows);
    if (restored.timeoutSec !== '') setTimeoutSec(restored.timeoutSec);
    setCustomOpen(script.params.length === 0 || restored.rows.length > 0);
  }

  // Save as they type, without a button: debounced rather than a request per
  // keystroke, skipped when nothing changed, and only once they have touched
  // something -- opening a script must not rewrite its draft.
  const savedDraft = prefill.data?.draft;
  const save = saveDraft.mutate;
  useEffect(() => {
    if (!touched || !seeded) return;
    const draft = draftFromForm({ values, rows: customRows, timeoutSec: timeout });
    if (savedDraft && sameDraft(savedDraft, draft)) return;

    const timer = setTimeout(() => save({ id: script.id, draft }), DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [touched, seeded, values, customRows, timeout, savedDraft, save, script.id]);

  const restoredNotice = prefill.data ? describePrefill(prefill.data) : null;
  // Counts every row that will be sent, not every row with a name: an argument
  // row usually has no label, and a badge that said 1 for three rows would be
  // worse than no badge.
  const customCount = customRows.filter((row) => !isBlankRow(row)).length;

  return (
    <div className="grid gap-4">
      <div className="border-line grid gap-3 border-t pt-4">
        {/* Says why the form is already filled in. Without it, restored values
            are indistinguishable from declared defaults. */}
        {restoredNotice ? <p className="text-faint text-micro">{restoredNotice}</p> : null}

        <RunRow
          label="Target"
          hint={
            selectedTarget
              ? `${selectedTarget.username}@${selectedTarget.host}:${selectedTarget.port}`
              : undefined
          }
          error={showErrors && effectiveTargetId === '' ? 'Pick a target' : null}
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={effectiveTargetId}
              disabled={noTargets || targets.isPending}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {targets.isPending ? <option value="">Loading targets…</option> : null}
              {noTargets ? <option value="">No targets configured</option> : null}
              {targetList.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name} — {target.username}@{target.host}
                </option>
              ))}
            </Select>
          )}
        </RunRow>

        {noTargets ? (
          <p className="text-mute text-meta">
            A run needs somewhere to run.{' '}
            <a href="#/targets" className="text-accent underline underline-offset-2">
              Add a target
            </a>{' '}
            first.
          </p>
        ) : null}

        {script.params.length > 0 ? (
          <>
            <p className="label border-line mt-1 border-t pt-4">Parameters</p>
            {script.params.map((param) => (
              <RunRow
                key={param.name}
                label={param.name}
                meta={`${param.type}${param.required ? ' · required' : ''}${
                  param.default !== null ? ` · default ${param.default}` : ''
                }`}
                hint={param.description || undefined}
                error={showErrors ? (errors[param.name] ?? null) : null}
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
          <p className="text-mute text-meta">
            This script declares no parameters, so the list below is the whole form: anything added
            there reaches it as an environment variable or a positional argument.
          </p>
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
            <span className="label">Custom parameters</span>
            {customCount > 0 ? (
              <span className="mono text-accent text-micro">{customCount}</span>
            ) : null}
          </button>

          {customOpen ? (
            <div className="grid gap-2">
              {customRows.map((row, index) => (
                // The name shares its line with the remove button and the value
                // takes the line below: a third column would leave the value too
                // narrow to read at this pane's width.
                <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5">
                  <TextInput
                    className="mono col-start-1 row-start-1 min-w-0"
                    aria-label={
                      row.mode === 'env'
                        ? `Custom parameter ${index + 1} name`
                        : `Custom argument ${index + 1} label`
                    }
                    placeholder={row.mode === 'env' ? 'NAME' : 'label (optional)'}
                    value={row.name}
                    onChange={(event) =>
                      editRows((current) =>
                        updateRow(current, row.id, { name: event.target.value }),
                      )
                    }
                  />
                  {/* Which channel this value travels on. `env` needs a shell
                      identifier as its name; `argv` is positional and its name
                      is only a label, so the two are not interchangeable. */}
                  <Select
                    // Wide enough for the longest option: at 92px the browser
                    // rendered "argv" as "arg".
                    className="col-start-2 row-start-1 w-[104px]"
                    aria-label={`Custom parameter ${index + 1} mode`}
                    value={row.mode}
                    onChange={(event) =>
                      editRows((current) =>
                        updateRow(current, row.id, {
                          mode: event.target.value as CustomParamMode,
                        }),
                      )
                    }
                  >
                    <option value="env">env</option>
                    <option value="argv">argv</option>
                  </Select>
                  <IconButton
                    label={`Remove parameter ${index + 1}`}
                    className="col-start-3 row-start-1"
                    onClick={() => editRows((current) => removeRow(current, row.id))}
                  >
                    <Trash className="size-4" aria-hidden />
                  </IconButton>
                  <TextInput
                    className="mono col-span-3 min-w-0"
                    aria-label={`Custom parameter ${index + 1} value`}
                    placeholder="value"
                    value={row.value}
                    onChange={(event) =>
                      editRows((current) =>
                        updateRow(current, row.id, { value: event.target.value }),
                      )
                    }
                  />
                  {/* Shown as soon as the row is non-blank, not on submit: the
                      mistakes here are typos the operator can see and fix, and a
                      blank row reports nothing. */}
                  {customErrors[row.id] ? (
                    <p className="text-danger text-meta col-span-3">{customErrors[row.id]}</p>
                  ) : null}
                </div>
              ))}

              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus className="size-4" aria-hidden />}
                  disabled={atCap}
                  onClick={appendRow}
                >
                  Add parameter
                </Button>
              </div>

              <p className="text-faint text-meta">
                <span className="mono">env</span> sets an environment variable, so its name must be
                a shell identifier, and the runner&apos;s own{' '}
                <span className="mono">SD_*</span> names are reserved. <span className="mono">argv</span>{' '}
                is a positional argument: it reaches the script as{' '}
                <span className="mono">$1</span>, <span className="mono">$2</span> … in the order
                listed here, and its name is only a label. At most {MAX_PARAM_COUNT} in all.
              </p>
            </div>
          ) : null}
        </div>

        <RunRow
          label="Timeout"
          hint={`Seconds. Blank uses the script's own limit${
            script.timeoutSec === null ? '' : ` (${script.timeoutSec}s)`
          }.`}
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

      {execute.isError ? <ErrorBanner message={errorMessage(execute.error)} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          icon={<Play className="size-4" aria-hidden />}
          loading={execute.isPending}
          disabled={noTargets}
          onClick={submit}
        >
          Run script
        </Button>
        <span className="text-faint text-meta">Values reach the script as environment variables.</span>
      </div>
    </div>
  );
}
