import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode, Folder, FolderOpen } from 'lucide-react';
import type { ScriptTreeNode } from '@dashboard/shared';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';

export type FlatRow = {
  node: ScriptTreeNode;
  depth: number;
};

/**
 * Flatten the tree into rows so directories can be collapsed without recursion
 * in the render path, and so the selected row can be located by path alone.
 */
function flatten(node: ScriptTreeNode, depth: number, collapsed: Set<string>, out: FlatRow[]): void {
  out.push({ node, depth });
  if (node.type !== 'dir' || collapsed.has(node.path)) return;
  for (const child of node.children ?? []) flatten(child, depth + 1, collapsed, out);
}

/**
 * The rows to draw, starting below the root.
 *
 * The pane that holds this tree names the source in its own header, so a root row
 * would repeat that name and spend a level of indent saying it. A root that is
 * not a directory cannot happen for a source; flattening it anyway is the only
 * drawing that would not silently empty the pane.
 */
export function childRows(root: ScriptTreeNode, collapsed: Set<string>): FlatRow[] {
  const out: FlatRow[] = [];
  if (root.type !== 'dir') {
    flatten(root, 0, collapsed, out);
    return out;
  }
  for (const child of root.children ?? []) flatten(child, 0, collapsed, out);
  return out;
}

function collectDirPaths(node: ScriptTreeNode, out: string[] = []): string[] {
  if (node.type === 'dir') out.push(node.path);
  for (const child of node.children ?? []) collectDirPaths(child, out);
  return out;
}

export function ScriptTree({
  root,
  selectedId,
  onSelect,
}: {
  root: ScriptTreeNode;
  selectedId: string | null;
  onSelect: (node: ScriptTreeNode) => void;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const rows = useMemo(() => childRows(root, collapsed), [root, collapsed]);

  function toggle(path: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function collapseAll(): void {
    // From the children, matching what `childRows` draws: collapsing the root
    // itself would put a path in the set that no row can ever match.
    setCollapsed(new Set((root.children ?? []).flatMap((child) => collectDirPaths(child))));
  }

  function expandAll(): void {
    setCollapsed(new Set());
  }

  return (
    <div className="min-h-0">
      <div className="grid gap-0.5">
        {rows.map(({ node, depth }) => {
          const isDir = node.type === 'dir';
          const isCollapsed = collapsed.has(node.path);
          const isSelected = node.script !== undefined && node.script.id === selectedId;
          const childCount = node.children?.length ?? 0;

          return (
            <div
              key={node.path || node.name}
              className={cn(
                'group flex h-9 items-center gap-1 rounded-lg pr-2 transition-colors duration-150 ease-out',
                isSelected ? 'bg-accent-soft' : 'hover:bg-panel-2',
              )}
              // Indent tracks the row height: at 36px rows a 12px step reads as
              // flat, and the tree is the one place structure has to be visible.
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
            >
              {isDir ? (
                <button
                  type="button"
                  onClick={() => toggle(node.path)}
                  aria-expanded={!isCollapsed}
                  className="focus-ring text-faint hover:text-ink hover:bg-panel-3 flex size-5 shrink-0 items-center justify-center rounded-md transition-colors duration-150"
                  aria-label={`${isCollapsed ? t('common.expand') : t('common.collapse')} ${node.name}`}
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-4" aria-hidden />
                  ) : (
                    <ChevronDown className="size-4" aria-hidden />
                  )}
                </button>
              ) : (
                <span className="size-5 shrink-0" aria-hidden />
              )}

              <button
                type="button"
                onClick={() => (isDir ? toggle(node.path) : onSelect(node))}
                className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-md text-left"
              >
                {isDir ? (
                  isCollapsed ? (
                    <Folder className="text-faint size-4 shrink-0" aria-hidden />
                  ) : (
                    <FolderOpen className="text-faint size-4 shrink-0" aria-hidden />
                  )
                ) : (
                  <FileCode
                    className={cn(
                      'size-4 shrink-0 transition-colors',
                      isSelected ? 'text-accent' : 'text-faint group-hover:text-mute',
                    )}
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    'text-body truncate',
                    isDir ? 'text-mute mono' : 'text-ink',
                  )}
                  title={node.path}
                >
                  {node.name}
                </span>
                {isDir && childCount > 0 ? (
                  <span className="mono text-faint text-micro ml-auto pl-2">{childCount}</span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>

      {/* Only when there is a directory to fold. A repository of loose scripts
          -- the common case -- has none, and there the footer was two buttons
          that did nothing when pressed, which reads as a broken control rather
          than as an action with no work to do. */}
      {rows.some((row) => row.node.type === 'dir') ? (
        <div className="border-line mt-3 flex gap-4 border-t px-1.5 pt-2.5">
          <button
            type="button"
            onClick={expandAll}
            className="focus-ring text-faint hover:text-ink text-meta rounded-md transition-colors duration-150"
          >
            {t('scripts.tree.expandAll')}
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="focus-ring text-faint hover:text-ink text-meta rounded-md transition-colors duration-150"
          >
            {t('scripts.tree.collapseAll')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
