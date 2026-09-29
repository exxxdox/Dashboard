import { Play } from 'lucide-react';
import type { ScriptSummary } from '@dashboard/shared';
import { Button } from '../components/Button';
import { useExecuteScript, useScriptRunDraft, useTargets } from '../api/queries';
import { useI18n } from '../lib/i18n';
import { navigate } from '../lib/router';
import { formFromDraft } from '../lib/run-draft';
import { validateRows, validateValues } from '../lib/run-params';
import { toRunInput } from '../lib/run-submit';

/**
 * Run the selected script with the settings already stored for it.
 *
 * "The current settings" are the saved draft, read back through the same
 * `formFromDraft` the run dialog seeds itself with -- so what this button sends
 * is what opening the dialog would have shown, not a second interpretation of
 * the same state.
 *
 * The target is the first one, which is what the dialog's picker defaults to,
 * and the button says so in its title: a one-click run must not be a guess about
 * which machine it lands on. If the stored settings would not pass the form's
 * own validation, this opens the dialog instead of firing a request the server
 * would refuse.
 */
export function RunNowButton({
  script,
  onNeedSettings,
}: {
  script: ScriptSummary;
  /** Opens the run dialog, for settings that have to be fixed first. */
  onNeedSettings: () => void;
}) {
  const { t } = useI18n();
  const targets = useTargets();
  const prefill = useScriptRunDraft(script.id);
  const execute = useExecuteScript();

  const target = (targets.data ?? [])[0];
  // The draft arrives with the page; until it does, a click would run the
  // declared defaults only, which is not what the button promises.
  const ready = Boolean(target) && prefill.isSuccess;

  function run(): void {
    if (!target || !prefill.data) return;

    const state = formFromDraft(prefill.data.draft, script.params);
    const broken =
      Object.keys(validateValues(script.params, state.values, t)).length > 0 ||
      Object.keys(validateRows(state.rows, script.params, t)).length > 0;

    if (broken) {
      onNeedSettings();
      return;
    }

    execute.mutate(
      { scriptId: script.id, input: toRunInput(state, target.id) },
      { onSuccess: (result) => navigate(`/runs/${encodeURIComponent(result.executionId)}`) },
    );
  }

  return (
    <Button
      variant="success"
      size="sm"
      className="px-3"
      icon={<Play className="size-4" aria-hidden />}
      aria-label={t('scripts.runNow')}
      title={target ? t('scripts.runNowTitle', { target: target.name }) : t('scripts.runNow')}
      disabled={!ready}
      loading={execute.isPending}
      onClick={run}
    />
  );
}
