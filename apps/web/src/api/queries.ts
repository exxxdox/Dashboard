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
  UpdateSourceInput,
  UpdateTargetInput,
} from '@dashboard/shared';
import { api } from './client';
import { queryKeys } from './queryKeys';
import type { UpdateScriptInput } from './types';

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
    // The check also re-stamps `lastCheck*` on the target, which the list shows.
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.targets() });
    },
  });
}

export function useDeleteTarget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTarget(id),
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
    onSuccess: (_result, id) => {
      void client.invalidateQueries({ queryKey: queryKeys.sources() });
      void client.invalidateQueries({ queryKey: queryKeys.sourceTree(id) });
      void client.invalidateQueries({ queryKey: queryKeys.overview() });
      void client.invalidateQueries({ queryKey: ['scripts'] });
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

export function useSourceBrowse(sourceId: string | null, path: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.sourceBrowse(sourceId ?? '', path),
    queryFn: () => api.browseSource(sourceId ?? '', path),
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
  });
}

export function useExecuteScript() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ scriptId, input }: { scriptId: string; input: ExecuteScriptInput }) =>
      api.executeScript(scriptId, input),
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
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['executions'] });
      void client.invalidateQueries({ queryKey: queryKeys.overview() });
    },
  });
}
