/**
 * The sources page and its form.
 *
 * Two words carry the whole feature and are kept apart on purpose: a `local`
 * source reads a directory of the shared mount where it already is, while a
 * `github` one is cloned and refreshed. "Mount" is the first kind, "Repo" the
 * second, and neither sentence may borrow the other's verb.
 */

const en = {
  'sources.eyebrow': 'Library',
  'sources.title': 'Sources',
  'sources.description':
    'Where scripts come from: a directory already shared with this container, or a GitHub repository kept in sync.',

  'sources.add': 'Add source',
  'sources.newTitle': 'New source',
  'sources.editTitle': 'Edit {name}',
  'sources.deleteNamed': 'Delete {name}',

  'sources.empty.title': 'No sources yet',
  'sources.empty.description':
    'Point the dashboard at a directory of scripts. Local directories are scanned in place; repositories are cloned and refreshed on demand.',

  // -- one row -------------------------------------------------------------
  'sources.scriptCount.one': '{count} script',
  'sources.scriptCount.many': '{count} scripts',
  'sources.repo': 'Repo',
  'sources.mount': 'Mount',
  'sources.neverSynced': 'Never synced',
  'sources.lastSynced': 'Last synced {when} · {at}',
  'sources.syncNow': 'Sync now',

  // -- the result of a sync ------------------------------------------------
  'sources.sync.added': 'added',
  'sources.sync.updated': 'updated',
  'sources.sync.removed': 'removed',
  'sources.sync.total': '{count} total',
  'sources.sync.warning.one': '{count} warning',
  'sources.sync.warning.many': '{count} warnings',
  'sources.openScripts': 'Open scripts',

  // -- the form ------------------------------------------------------------
  'sources.form.name': 'Name',
  'sources.form.namePlaceholder': 'ops-scripts',
  'sources.form.kind': 'Kind',
  'sources.form.kindHintEdit': 'Fixed: it decides where the files live.',
  'sources.form.kindHintGithub': 'Cloned and refreshed on sync.',
  'sources.form.kindHintLocal': 'Already on this machine.',
  'sources.form.localDirectory': 'Local directory',
  'sources.form.githubRepository': 'GitHub repository',
  'sources.form.repoUrl': 'Repository URL',
  'sources.form.repoUrlPlaceholder': 'https://github.com/acme/ops',
  'sources.form.branch': 'Branch',
  'sources.form.branchHint': 'Blank uses the default branch.',
  'sources.form.branchPlaceholder': 'main',
  'sources.form.subdirectory': 'Subdirectory',
  'sources.form.directory': 'Directory',
  'sources.form.subPathHintGithub':
    'Path inside the repository to treat as the script root. Blank uses the repository root.',
  'sources.form.subPathHintLocal':
    'Directory inside the shared mount that holds the scripts, relative to the mount root.',
  'sources.form.subPathPlaceholderGithub': 'scripts',
  'sources.form.subPathPlaceholderLocal': 'ops-scripts',
  'sources.form.localNote':
    'The directory must already exist inside the shared mount. Git-backed directories are browsable from the source list once created.',
  // Split around the emphasised "Never synced" the sentence ends on.
  'sources.form.editNote.before':
    'Changing the repository, branch or directory leaves what was already scanned behind, so the source goes back to',
  'sources.form.editNote.after': 'until you sync it again.',

  'sources.form.required': 'Required',
  'sources.form.save': 'Save source',
  'sources.form.cancel': 'Cancel',
} as const;

const zh: Record<keyof typeof en, string> = {
  'sources.eyebrow': '脚本库',
  'sources.title': '脚本源',
  'sources.description': '脚本的来源：已经共享给此容器的目录，或保持同步的 GitHub 仓库。',

  'sources.add': '添加脚本源',
  'sources.newTitle': '新建脚本源',
  'sources.editTitle': '编辑 {name}',
  'sources.deleteNamed': '删除 {name}',

  'sources.empty.title': '还没有脚本源',
  'sources.empty.description':
    '把仪表盘指向存放脚本的目录。本地目录就地扫描；仓库按需克隆和刷新。',

  'sources.scriptCount.one': '{count} 个脚本',
  'sources.scriptCount.many': '{count} 个脚本',
  'sources.repo': '仓库',
  'sources.mount': '挂载点',
  'sources.neverSynced': '从未同步',
  'sources.lastSynced': '最近同步于 {when} · {at}',
  'sources.syncNow': '立即同步',

  'sources.sync.added': '新增',
  'sources.sync.updated': '更新',
  'sources.sync.removed': '移除',
  'sources.sync.total': '共 {count} 个',
  'sources.sync.warning.one': '{count} 条警告',
  'sources.sync.warning.many': '{count} 条警告',
  'sources.openScripts': '查看脚本',

  'sources.form.name': '名称',
  'sources.form.namePlaceholder': 'ops-scripts',
  'sources.form.kind': '类型',
  'sources.form.kindHintEdit': '已固定：它决定文件所在的位置。',
  'sources.form.kindHintGithub': '同步时克隆并刷新。',
  'sources.form.kindHintLocal': '已在本机上。',
  'sources.form.localDirectory': '本地目录',
  'sources.form.githubRepository': 'GitHub 仓库',
  'sources.form.repoUrl': '仓库 URL',
  'sources.form.repoUrlPlaceholder': 'https://github.com/acme/ops',
  'sources.form.branch': '分支',
  'sources.form.branchHint': '留空则使用默认分支。',
  'sources.form.branchPlaceholder': 'main',
  'sources.form.subdirectory': '子目录',
  'sources.form.directory': '目录',
  'sources.form.subPathHintGithub': '仓库中作为脚本根目录的路径。留空则使用仓库根目录。',
  'sources.form.subPathHintLocal': '共享挂载点内存放脚本的目录，相对于挂载根目录。',
  'sources.form.subPathPlaceholderGithub': 'scripts',
  'sources.form.subPathPlaceholderLocal': 'ops-scripts',
  'sources.form.localNote':
    '该目录必须已存在于共享挂载点中。创建后，Git 仓库目录可从脚本源列表浏览。',
  'sources.form.editNote.before':
    '更改仓库、分支或目录会遗留已扫描的内容，因此在再次同步之前，该脚本源会回到',
  'sources.form.editNote.after': '状态。',

  'sources.form.required': '必填',
  'sources.form.save': '保存脚本源',
  'sources.form.cancel': '取消',
};

export const sourcesMessages = { en, zh };
