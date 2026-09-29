import { describe, expect, test } from 'vitest';
import type { ScriptTreeNode } from '@dashboard/shared';
import { childRows } from './ScriptTree';

function dir(name: string, children: ScriptTreeNode[]): ScriptTreeNode {
  return { name, path: name, type: 'dir', children };
}

function file(name: string): ScriptTreeNode {
  return { name, path: name, type: 'file' };
}

const TREE = dir('source', [
  file('top.sh'),
  dir('deploy', [file('api.sh'), dir('nested', [file('deep.sh')])]),
]);

describe('childRows', () => {
  test('draws the root’s children at depth 0, without a row for the root itself', () => {
    // Arrange / Act
    const rows = childRows(TREE, new Set());

    // Assert: the pane header names the source, so the root row would repeat it.
    expect(rows.map((row) => [row.node.name, row.depth])).toEqual([
      ['top.sh', 0],
      ['deploy', 0],
      ['api.sh', 1],
      ['nested', 1],
      ['deep.sh', 2],
    ]);
  });

  test('hides the children of a collapsed directory but keeps the directory', () => {
    // Arrange / Act
    const rows = childRows(TREE, new Set(['deploy']));

    // Assert
    expect(rows.map((row) => row.node.name)).toEqual(['top.sh', 'deploy']);
  });

  test('returns no rows for an empty source', () => {
    // Arrange / Act
    const rows = childRows(dir('source', []), new Set());

    // Assert
    expect(rows).toEqual([]);
  });

  test('draws a root that is not a directory as a single row', () => {
    // A source root is always a directory, so this cannot happen in practice --
    // but an empty pane would hide the failure instead of showing it.
    // Arrange / Act
    const rows = childRows(file('lonely.sh'), new Set());

    // Assert
    expect(rows.map((row) => [row.node.name, row.depth])).toEqual([['lonely.sh', 0]]);
  });
});
