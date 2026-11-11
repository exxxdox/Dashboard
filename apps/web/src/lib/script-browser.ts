const SOURCE_KEY = 'dashboard.scripts.source';
const DIRECTORY_KEY = 'dashboard.scripts.collapsed.';

export function readScriptSource(): string {
  try {
    return window.localStorage.getItem(SOURCE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveScriptSource(sourceId: string): void {
  try {
    window.localStorage.setItem(SOURCE_KEY, sourceId);
  } catch {
    // Storage restrictions must not prevent browsing scripts.
  }
}

export function readCollapsedDirectories(sourceId: string): Set<string> {
  try {
    const paths: unknown = JSON.parse(window.localStorage.getItem(DIRECTORY_KEY + sourceId) ?? '[]');
    return new Set(Array.isArray(paths) && paths.every((path) => typeof path === 'string') ? paths : []);
  } catch {
    return new Set();
  }
}

export function saveCollapsedDirectories(sourceId: string, paths: Set<string>): void {
  try {
    window.localStorage.setItem(DIRECTORY_KEY + sourceId, JSON.stringify([...paths]));
  } catch {
    // Storage restrictions must not prevent expanding or collapsing directories.
  }
}
