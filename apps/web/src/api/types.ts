import type { ExecutionSummary } from '@dashboard/shared';

/** Endpoints whose response shapes are not exported from `@dashboard/shared`. */

export type HealthResponse = {
  status: 'ok';
  version: string;
  schemaVersion: number;
};

export type OverviewResponse = {
  counts: {
    targets: number;
    sources: number;
    scripts: number;
    running: number;
    failed24h: number;
  };
  recent: ExecutionSummary[];
};

export type ExecutionListResponse = {
  items: ExecutionSummary[];
  total: number;
};

/** `PATCH /api/scripts/:id` — omitted fields are left unchanged. */
export type UpdateScriptInput = {
  displayName?: string;
  description?: string | null;
  timeoutSec?: number | null;
  interpreterOverride?: string[] | null;
};

export type BrowseEntry = {
  name: string;
  type: 'dir' | 'file';
  sizeBytes: number | null;
};

export type BrowseResponse = {
  path: string;
  entries: BrowseEntry[];
};
