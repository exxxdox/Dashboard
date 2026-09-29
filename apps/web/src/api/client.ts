import type {
  AuthStatus,
  CreateSourceInput,
  LoginInput,
  CreateTargetInput,
  ExecuteScriptInput,
  ExecutionLogChunk,
  ExecutionSummary,
  ScriptSummary,
  ScriptTreeNode,
  RunDraft,
  ScriptRunPrefill,
  SourceSummary,
  SyncResult,
  TargetCheckResult,
  TargetSummary,
  UpdateSourceInput,
  UpdateTargetInput,
} from '@script-dashboard/shared';
import type {
  BrowseResponse,
  ExecutionListResponse,
  HealthResponse,
  OverviewResponse,
  UpdateScriptInput,
} from './types';

const API_BASE = '/api';

export type ApiErrorPayload = {
  error: { code: string; message: string; details?: unknown };
};

/** Carries the server's own code and message so the UI never invents one. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

type QueryValue = string | number | boolean | undefined | null;

export type RequestOptions = {
  // PUT is for the run draft: replacing the whole thing is the honest verb for
  // a draft, which is never merged field by field.
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    // An aborted request is the caller's own doing; let it surface unchanged.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(
      0,
      'network_error',
      'Could not reach the server. Check that the API is running and reachable.',
      cause,
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed = text === '' ? null : parseJson(text);

  if (!response.ok) {
    // A session can expire between requests, so every 401 is a signal to the
    // shell rather than to the caller: the caller usually cannot recover from it
    // anyway, and there would be nowhere to render the login form from.
    if (response.status === 401 && typeof window?.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }

    const envelope = (parsed ?? null) as Partial<ApiErrorPayload> | null;
    const detail = envelope?.error;
    throw new ApiError(
      response.status,
      detail?.code ?? 'http_error',
      detail?.message ?? `Request failed with status ${response.status}`,
      detail?.details,
    );
  }

  return parsed as T;
}

/** Fired on any 401 so the app can drop back to the sign-in screen. */
export const UNAUTHORIZED_EVENT = 'sd:unauthorized';

export const api = {
  authStatus: () => apiRequest<AuthStatus>('/auth/me'),
  login: (body: LoginInput) => apiRequest<AuthStatus>('/auth/login', { method: 'POST', body }),
  logout: () => apiRequest<AuthStatus>('/auth/logout', { method: 'POST' }),

  health: () => apiRequest<HealthResponse>('/health'),
  overview: () => apiRequest<OverviewResponse>('/overview'),

  listTargets: () => apiRequest<TargetSummary[]>('/targets'),
  getTarget: (id: string) => apiRequest<TargetSummary>(`/targets/${encodeURIComponent(id)}`),
  createTarget: (body: CreateTargetInput) =>
    apiRequest<TargetSummary>('/targets', { method: 'POST', body }),
  updateTarget: (id: string, body: UpdateTargetInput) =>
    apiRequest<TargetSummary>(`/targets/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteTarget: (id: string) =>
    apiRequest<void>(`/targets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  checkTarget: (id: string) =>
    apiRequest<TargetCheckResult>(`/targets/${encodeURIComponent(id)}/check`, { method: 'POST' }),

  listSources: () => apiRequest<SourceSummary[]>('/sources'),
  createSource: (body: CreateSourceInput) =>
    apiRequest<SourceSummary>('/sources', { method: 'POST', body }),
  updateSource: (id: string, body: UpdateSourceInput) =>
    apiRequest<SourceSummary>(`/sources/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteSource: (id: string) =>
    apiRequest<void>(`/sources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  syncSource: (id: string) =>
    apiRequest<SyncResult>(`/sources/${encodeURIComponent(id)}/sync`, { method: 'POST' }),
  sourceTree: (id: string) =>
    apiRequest<ScriptTreeNode>(`/sources/${encodeURIComponent(id)}/tree`),
  browseSource: (id: string, path: string) =>
    apiRequest<BrowseResponse>(`/sources/${encodeURIComponent(id)}/browse`, { query: { path } }),

  listScripts: (filter: { sourceId?: string; q?: string } = {}) =>
    apiRequest<ScriptSummary[]>('/scripts', { query: filter }),
  // The script has no path on a host: it is staged into a temporary directory
  // per run, so there is nothing stable to name here.
  getScript: (id: string) =>
    apiRequest<ScriptSummary & { content: string | null }>(`/scripts/${encodeURIComponent(id)}`),
  updateScript: (id: string, body: UpdateScriptInput) =>
    apiRequest<ScriptSummary>(`/scripts/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  // What the run form held last time, and where that came from.
  scriptRunDraft: (id: string) =>
    apiRequest<ScriptRunPrefill>(`/scripts/${encodeURIComponent(id)}/run-draft`),
  saveScriptRunDraft: (id: string, body: RunDraft) =>
    apiRequest<ScriptRunPrefill>(`/scripts/${encodeURIComponent(id)}/run-draft`, {
      method: 'PUT',
      body,
    }),
  executeScript: (id: string, body: ExecuteScriptInput) =>
    apiRequest<{ executionId: string; status: ExecutionSummary['status'] }>(
      `/scripts/${encodeURIComponent(id)}/execute`,
      { method: 'POST', body },
    ),

  listExecutions: (
    filter: {
      scriptId?: string;
      targetId?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) => apiRequest<ExecutionListResponse>('/executions', { query: filter }),
  getExecution: (id: string) =>
    apiRequest<ExecutionSummary>(`/executions/${encodeURIComponent(id)}`),
  getExecutionLogs: (id: string, afterSeq?: number) =>
    apiRequest<ExecutionLogChunk[]>(`/executions/${encodeURIComponent(id)}/logs`, {
      query: { afterSeq },
    }),
  cancelExecution: (id: string) =>
    apiRequest<ExecutionSummary>(`/executions/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  deleteExecution: (id: string) =>
    apiRequest<void>(`/executions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
