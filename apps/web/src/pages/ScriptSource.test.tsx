import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { ScriptSource } from './ScriptSource';

vi.mock('../components/BashEditor', () => ({ BashEditor: ({ value, readOnly, label }: { value: string; readOnly: boolean; label: string }) => <pre aria-label={label} data-readonly={readOnly}>{value}</pre> }));
vi.mock('../lib/i18n', () => ({ useT: () => (key: string) => key }));

test('previews Bash in read-only mode and bounds displayed content to 400 lines', () => {
  const content = Array.from({ length: 401 }, (_, index) => `echo line-${index + 1}`).join('\n');
  const html = renderToStaticMarkup(<ScriptSource content={content} format="sh" />);
  expect(html).toContain('data-readonly="true"');
  expect(html).toContain('echo line-400');
  expect(html).not.toContain('echo line-401');
  expect(html).toContain('scripts.source.overflow');
});

test('displays script-like markup as text', () => {
  const html = renderToStaticMarkup(<ScriptSource content={'echo "<script>alert(1)</script>"'} format="sh" />);
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
});
