import { expect, test } from 'vitest';
import { newExecutionId } from './ids.js';

test('execution IDs contain only 96 random bits encoded as URL-safe characters', () => {
  const ids = Array.from({ length: 100 }, () => newExecutionId());
  for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  expect(new Set(ids).size).toBe(ids.length);
});
