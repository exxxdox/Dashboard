import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  AuthStatus,
  CreateSourceInput,
  LoginInput,
  CreateTargetInput,
  ExecuteScriptInput,
  ExecutionSummary,
  RunDraft,
  ScriptRunPrefill,
  ScriptSummary,
  TargetSummary,
  TestNotificationInput,
  UpdateAppSettingsInput,
  UpdateDnsSettingsInput,
  UpdateSourceInput,
  UpdateTargetInput,
} from '@dashboard/shared';
import { api } from './client';
import { report } from './query-client';
import { queryKeys } from './queryKeys';
import type { UpdateScriptInput } from './types';
import { globalTranslate, type Translate } from '../lib/i18n';
import {
  ipv6ProbeOutcome,
  recordProbeOutcome,
  syncOutcome,
  targetCheckOutcome,
  updateOutcome,
  type Outcome,
} from '../lib/outcome';

/* -------------------------------------------------------------------- auth */

/**
 * Whether this deployment wants a sign-in. Kept fresh rather than cached: it is
 * the one answer the whole shell branches on, and it changes the moment someone
 * signs in or out.
 */
export function useAuthStatus() {
  return useQuery({
    queryKey: queryKeys.auth(),
    queryFn: api.authStatus,
    staleTime: 0,
    retry: false,
  });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.login(input),
    meta: { success: 'toast.signedIn' },
    onSuccess: (status: AuthStatus) => {
      client.setQueryData(queryKeys.auth(), status);
      // Everything cached was fetched while signed out (or by someone else), so
      // nothing from before the sign-in may be reused.
      void client.invalidateQueries();
    },
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    meta: { success: 'toast.signedOut' },
    onSuccess: (status: AuthStatus) => {
      client.setQueryData(queryKeys.auth(), status);
      client.clear();
      client.setQueryData(queryKeys.auth(), status);
    },
  });
}

/* ------------------------------------------------------------------ health */

export function useHealth(): UseQueryResult<{ status: 'ok'; version: string; schemaVersion: number }> {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: api.health,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useOverview() {
  return useQuery({ queryKey: queryKeys.overview(), queryFn: api.overview });
}

/* ----------------------------------------------------------------- targets */

export function useTargets() {
  return useQuery({ queryKey: queryKeys.targets(), queryFn: api.listTargets });
}

export function useCreateTarget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTargetInput) => api.createTarget(input),
    meta: { success: 'toast.targetCreated' },
    onSuccess: (target) => {
      client.setQueryData<TargetSummary[]>(queryKeys.targets(), (current) =>
        current ? [...current, target] : [target],
      );
      void client.invalidateQueries({ queryKey: queryKeys.overview() });
    },
  });
}

export function useUpdateTarget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTargetInput }) =>
      api.updateTarget(id, input),
    meta: { success: 'toast.targetSaved' },
    onSuccess: (target) => {
      client.setQueryData<TargetSummary[]>(queryKeys.targets(), (current) =>
        current?.map((item) => (item.id === target.id ? target : item)),
      );
    },
  });
}

export function useCheckTarget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.checkTarget(id),
    // No `meta.success`: a check answers with which of the host's capabilities
    // it could and could not confirm, and a bare "check complete" would throw
    // away the only part worth reading.
    onSuccess: (result) => {
      // The check also re-stamps `lastCheck*` on the target, which the list shows.
      void client.invalidateQueries({ queryKey: queryKeys.targets() });
      report(targetCheckOutcome(globalTranslate, result));
    },
  });
}

export function useDeleteTarget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTarget(id),
    meta: { success: 'toast.targetDeleted' },
    onSuccess: (_result, id) => {
      client.setQueryData<TargetSummary[]>(queryKeys.targets(), (current) =>
        current?.filter((item) => item.id !== id),
      );
      void client.invalidateQueries({ queryKey: queryKeys.overview() });
    },
  });
}

/* ----------------------------------------------------------------- sources */

export function useSources() {
  return useQuery({ queryKey: queryKeys.sources(), queryFn: api.listSources });
}

export function useCreateSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSourceInput) => api.createSource(input),
    meta: { success: 'toast.sourceCreated' },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.sources() });
      void client.invalidateQueries({ queryKey: queryKeys.overview() });
    },
  });
}

export function useUpdateSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSourceInput }) =>
      api.updateSource(id, input),
    meta: { success: 'toast.sourceSaved' },
    onSuccess: (source) => {
      void client.invalidateQueries({ queryKey: queryKeys.sources() });
      void client.invalidateQueries({ queryKey: queryKeys.overview() });
      // A different directory or ref means a different set of scripts, and the
      // tree the scripts page is showing belongs to the old one.
      void client.invalidateQueries({ queryKey: queryKeys.sourceTree(source.id) });
      void client.invalidateQueries({ queryKey: ['scripts'] });
    },
  });
}

export function useDeleteSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSource(id),
    meta: { success: 'toast.sourceDeleted' },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.sources() });
      void client.invalidateQueries({ queryKey: queryKeys.overview() });
    },
  });
}

export function useSyncSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.syncSource(id),
    onSuccess: (result, id) => {
      void client.invalidateQueries({ queryKey: queryKeys.sources() });
      void client.invalidateQueries({ queryKey: queryKeys.sourceTree(id) });
      void client.invalidateQueries({ queryKey: queryKeys.overview() });
      void client.invalidateQueries({ queryKey: ['scripts'] });
      // What a sync did is a count and whatever it complained about; the counts
      // are the answer to "did it work", so they travel with the message.
      report(syncOutcome(globalTranslate, result));
    },
  });
}

export function useSourceTree(sourceId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.sourceTree(sourceId ?? ''),
    queryFn: () => api.sourceTree(sourceId ?? ''),
    enabled: enabled && Boolean(sourceId),
  });
}

/* ----------------------------------------------------------------- scripts */

export function useScripts(filter: { sourceId?: string; q?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.scripts(filter),
    queryFn: () => api.listScripts(filter),
  });
}

export function useScript(scriptId: string | null) {
  return useQuery({
    queryKey: queryKeys.script(scriptId ?? ''),
    queryFn: () => api.getScript(scriptId ?? ''),
    enabled: Boolean(scriptId),
  });
}

export function useUpdateScript() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateScriptInput }) =>
      api.updateScript(id, input),
    meta: { success: 'toast.scriptSaved' },
    onSuccess: (script: ScriptSummary) => {
      void client.invalidateQueries({ queryKey: queryKeys.script(script.id) });
      void client.invalidateQueries({ queryKey: ['scripts'] });
      void client.invalidateQueries({ queryKey: queryKeys.sourceTree(script.sourceId) });
    },
  });
}

/**
 * What this script's run form held last time.
 *
 * Cached but never refetched on focus: the values are restored once, and a
 * background refetch would overwrite what the operator is typing.
 */
export function useScriptRunDraft(scriptId: string | null) {
  return useQuery({
    queryKey: queryKeys.scriptRunDraft(scriptId ?? ''),
    queryFn: () => api.scriptRunDraft(scriptId ?? ''),
    enabled: Boolean(scriptId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useSaveScriptRunDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: RunDraft }) =>
      api.saveScriptRunDraft(id, draft),
    // The response is the same object the query holds; a run in flight does not
    // care about it, so nothing else is invalidated here.
    onSuccess: (prefill: ScriptRunPrefill, { id }) => {
      client.setQueryData(queryKeys.scriptRunDraft(id), prefill);
    },
    // A debounced background write: it repeats on its own, so announcing it
    // would be a toast per pause in typing, and announcing each failure worse.
    meta: { quiet: true },
  });
}

export function useExecuteScript() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ scriptId, input }: { scriptId: string; input: ExecuteScriptInput }) =>
      api.executeScript(scriptId, input),
    meta: { success: 'toast.runStarted' },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['executions'] });
      void client.invalidateQueries({ queryKey: queryKeys.overview() });
    },
  });
}

/* -------------------------------------------------------------- executions */

export function useExecutions(filter: {
  scriptId?: string;
  targetId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: queryKeys.executions(filter),
    queryFn: () => api.listExecutions(filter),
    placeholderData: (previous) => previous,
  });
}

export function useExecution(executionId: string | null) {
  return useQuery({
    queryKey: queryKeys.execution(executionId ?? ''),
    queryFn: () => api.getExecution(executionId ?? ''),
    enabled: Boolean(executionId),
  });
}

/** Streamed status frames are the source of truth while a run is live. */
export function useApplyExecutionUpdate() {
  const client = useQueryClient();
  return (execution: ExecutionSummary): void => {
    client.setQueryData(queryKeys.execution(execution.id), execution);
    client.setQueryData<{ items: ExecutionSummary[]; total: number } | undefined>(
      queryKeys.executions({}),
      (current) =>
        current
          ? { ...current, items: current.items.map((item) => (item.id === execution.id ? execution : item)) }
          : current,
    );
  };
}

export function useCancelExecution() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelExecution(id),
    meta: { success: 'toast.runCancelled' },
    onSuccess: (execution) => {
      client.setQueryData(queryKeys.execution(execution.id), execution);
      void client.invalidateQueries({ queryKey: ['executions'] });
    },
  });
}

export function useDeleteExecution() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteExecution(id),
    meta: { success: 'toast.runDeleted' },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['executions'] });
      void client.invalidateQueries({ queryKey: queryKeys.overview() });
    },
  });
}

/* --------------------------------------------------------------------- dns */

/**
 * One invalidation for the whole console.
 *
 * `['dns']` is the prefix of every DNS key, so a single call refreshes the state
 * payload and any page of history. Every action below uses it, including a
 * failed update: a failure is a history row, and the page shows it as one.
 */
function useInvalidateDns(): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['dns'] });
  };
}

/**
 * The three console actions report what they found, so none of them declares a
 * `meta.success`: the message is the result. Each still invalidates, because a
 * probe's answer is also new page state -- the address it detected is the
 * record's subject.
 */
function useDnsAction<TResult>(
  mutationFn: () => Promise<TResult>,
  describe: (t: Translate, result: TResult) => Outcome,
) {
  const invalidate = useInvalidateDns();
  return useMutation({
    mutationFn,
    onSuccess: (result: TResult) => {
      invalidate();
      report(describe(globalTranslate, result));
    },
  });
}

export function useDnsState() {
  return useQuery({
    queryKey: queryKeys.dns(),
    queryFn: api.dnsState,
  });
}

export function useDnsChecks(filter: { limit: number; offset: number }) {
  return useQuery({
    queryKey: queryKeys.dnsChecks(filter),
    queryFn: () => api.listDnsChecks(filter),
    placeholderData: (previous) => previous,
  });
}

export function useSaveDnsSettings() {
  const invalidate = useInvalidateDns();
  return useMutation({
    mutationFn: (input: UpdateDnsSettingsInput) => api.saveDnsSettings(input),
    meta: { success: 'toast.dnsSettingsSaved' },
    onSuccess: invalidate,
  });
}

export function useDetectDnsIpv6() {
  return useDnsAction(api.detectDnsIpv6, ipv6ProbeOutcome);
}

export function useQueryDnsRecord() {
  return useDnsAction(api.queryDnsRecord, recordProbeOutcome);
}

export function useRunDnsUpdate() {
  return useDnsAction(api.runDnsUpdate, updateOutcome);
}

/* ---------------------------------------------------------------- settings */

export function useAppSettings() {
  return useQuery({ queryKey: queryKeys.settings(), queryFn: api.settingsState });
}

export function useSaveAppSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAppSettingsInput) => api.saveSettings(input),
    meta: { success: 'toast.settingsSaved' },
    // The response is the saved row, so the cache is set rather than
    // invalidated: a refetch would answer with the same object.
    onSuccess: (settings) => {
      client.setQueryData(queryKeys.settings(), settings);
    },
  });
}

/**
 * The test message is sent and its answer is kept by the caller, not cached: it
 * says something about the credentials in the form, which the server has not
 * stored yet.
 */
export function useTestNotification() {
  return useMutation({
    mutationFn: (input: TestNotificationInput) => api.testNotification(input),
    meta: { success: 'toast.notificationSent' },
  });
}
