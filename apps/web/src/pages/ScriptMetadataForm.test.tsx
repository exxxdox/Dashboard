import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import type { ScriptSummary } from '@dashboard/shared';
import { ScriptMetadataForm } from './ScriptMetadataForm';

const state = vi.hoisted(() => ({ kind: 'local' }));
vi.mock('../api/queries', () => ({
  useSources: () => ({ data: [{ id: 'source', kind: state.kind }] }),
  useUpdateScript: () => ({ isPending: false }),
}));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const script = {
  id: 'script', sourceId: 'source', fileName: 'actual.sh', displayName: 'Friendly title',
  description: null, timeoutSec: null, interpreterOverride: null,
} as ScriptSummary;

test('local name field edits the filename while GitHub keeps its display name', () => {
  state.kind = 'local';
  const local = renderToStaticMarkup(<ScriptMetadataForm script={script} />);
  expect(local).toContain('value="actual.sh"');
  expect(local).toContain('scripts.file.renameHint');
  state.kind = 'github';
  const github = renderToStaticMarkup(<ScriptMetadataForm script={script} />);
  expect(github).toContain('value="Friendly title"');
  expect(github).not.toContain('scripts.file.renameHint');
});
