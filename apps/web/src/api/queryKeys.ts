/** One place for cache keys so invalidation cannot drift from fetching. */
export const queryKeys = {
  auth: () => ['auth'] as const,
  health: () => ['health'] as const,
  overview: () => ['overview'] as const,

  targets: () => ['targets'] as const,

  sources: () => ['sources'] as const,
  sourceTree: (id: string) => ['sources', id, 'tree'] as const,
  sourceBrowse: (id: string, path: string) => ['sources', id, 'browse', path] as const,

  scripts: (filter: { sourceId?: string; q?: string }) => ['scripts', filter] as const,
  script: (id: string) => ['scripts', id] as const,
  scriptRunDraft: (id: string) => ['scripts', id, 'run-draft'] as const,

  executions: (filter: Record<string, string | number | undefined>) =>
    ['executions', filter] as const,
  execution: (id: string) => ['executions', id] as const,

  // One key for the whole DNS page: its state payload already carries the
  // settings, the probe results and a preview of the history, so there is
  // nothing to fetch in parallel with it.
  dns: () => ['dns'] as const,
  dnsChecks: (filter: { limit: number; offset: number }) => ['dns', 'checks', filter] as const,
};
