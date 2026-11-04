import { expect, it } from 'vitest';
import english from './translations.json';
import { translateRelayText } from './i18n';

it('provides English text with the same interpolation slots for every migrated label', () => {
  for (const [source, translation] of Object.entries(english)) {
    expect(translation).not.toMatch(/[\u4e00-\u9fff]/);
    expect(translation.match(/\{\d+\}/g)?.sort()).toEqual(source.match(/\{\d+\}/g)?.sort());
  }
});
it('uses the dashboard locale without translating administrator-provided names', () => {
  expect(translateRelayText('已尝试 {0} 条路由', [3], 'en')).toBe('Tried 3 routes');
  expect(translateRelayText('已尝试 {0} 条路由', [3], 'zh')).toBe('已尝试 3 条路由');
  expect(translateRelayText('my-custom-model', [], 'en')).toBe('my-custom-model');
});
