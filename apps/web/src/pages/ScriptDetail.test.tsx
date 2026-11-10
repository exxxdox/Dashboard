import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { ScriptDetail } from './ScriptDetail';

const state = vi.hoisted(() => ({ kind: 'github' }));
vi.mock('../api/queries', () => ({
  useScript: () => ({ data: { id: 'script', sourceId: 'actual-source', content: 'echo hello', format: 'sh' } }),
  useSources: () => ({ data: [{ id: 'other-local-source', kind: 'local' }, { id: 'actual-source', kind: state.kind }] }),
}));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }), useT: () => (key: string) => key }));
vi.mock('./ScriptFileEditor', () => ({ ScriptFileActions: () => <div>file-write-actions</div> }));
vi.mock('./ScriptSource', () => ({ ScriptSource: () => <pre>source-content</pre> }));

test('uses the script actual source rather than another selected local source to allow editing', () => {
  state.kind = 'github';
  const html = renderToStaticMarkup(<ScriptDetail scriptId="script" />);
  expect(html).not.toContain('file-write-actions');
  expect(html).toContain('scripts.file.readOnly');
  expect(html).toContain('source-content');
  state.kind = 'local';
  const localHtml = renderToStaticMarkup(<ScriptDetail scriptId="script" />);
  expect(localHtml).toContain('file-write-actions');
  expect(localHtml).not.toContain('scripts.file.readOnly');
});
