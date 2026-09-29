/**
 * The script library: the tree, one script's page, and the picker used when
 * filtering runs by script.
 *
 * The words for a script's *content* are deliberately absent -- a path, a
 * content hash and a line of shell are data, and translating any of them would
 * make the screen disagree with the file it is describing.
 */

const en = {
  'scripts.eyebrow': 'Library',
  'scripts.description':
    'Every script the dashboard has discovered, grouped by the source it came from.',
  'scripts.loadingSources': 'Loading sources…',
  'scripts.noSources.title': 'No sources configured',
  'scripts.noSources.description':
    'A source is a directory of scripts — either a folder already shared with the container, or a GitHub repository to sync. Scripts appear here as soon as one exists.',
  'scripts.addSource': 'Add a source',
  'scripts.source': 'Source',
  'scripts.sync': 'Sync',
  'scripts.noSelection.title': 'No script selected',
  'scripts.noSelection.description':
    'Pick a script from the tree to see its parameters, its source, and the form that runs it.',
  'scripts.chooseSource': 'Choose a source to see its scripts.',
  'scripts.loadingTree': 'Loading tree…',

  // -- one script ----------------------------------------------------------
  'scripts.loadingScript': 'Loading script…',
  'scripts.refresh': 'Refresh',
  'scripts.panel.source': 'Source',
  'scripts.panel.run': 'Run settings',
  'scripts.panel.facts': 'Facts',
  'scripts.panel.metadata': 'Metadata',
  // The three buttons in the identity bar open these; the titles above are what
  // the dialogs are called, and these say what is inside them.
  'scripts.dialog.facts.description':
    'Everything the last sync recorded for this file: its size, where it came from, and which content hash it was read at.',
  'scripts.dialog.metadata.description':
    'How this script is listed and run. Changes apply to the next run, not to past ones.',
  'scripts.dialog.run.description':
    'Pick a host and fill in what the script needs, then start it. These values are remembered for the next time.',
  'scripts.runNow': 'Run now',
  'scripts.runNowTitle': 'Run now on {target}, with the settings saved for this script',
  'scripts.unsavedChanges': 'Unsaved changes',
  'scripts.unreadable.title': 'File is not readable',
  'scripts.unreadable.description':
    'The script is registered but its content could not be read from the shared directory. Re-sync the source, or check that the directory is mounted.',
  'scripts.field.format': 'Format',
  'scripts.field.size': 'Size',
  'scripts.field.interpreter': 'Interpreter',
  'scripts.field.timeout': 'Timeout',
  'scripts.field.sourcePath': 'Source path',
  'scripts.field.discovered': 'Discovered',
  'scripts.field.contentHash': 'Content hash',
  'scripts.field.displayName': 'Display name',
  'scripts.field.description': 'Description',
  'scripts.field.timeoutSec': 'Timeout (sec)',
  'scripts.field.interpreterHint': 'e.g. bash -eu',
  'scripts.auto': 'auto',
  'scripts.noChanges': 'No changes',

  // -- the source viewer ---------------------------------------------------
  'scripts.source.lines': '{count} lines',
  'scripts.source.overflow': 'first {shown} of {total} lines',

  // -- the script picker ---------------------------------------------------
  'scripts.filter.label': 'script',
  'scripts.filter.clear': 'Clear script filter',
  'scripts.filter.placeholder': 'Filter by script…',
  'scripts.filter.searching': 'Searching…',
  'scripts.filter.noMatch': 'No scripts match “{query}”.',

  // -- the tree ------------------------------------------------------------
  'scripts.tree.expandAll': 'Expand all',
  'scripts.tree.collapseAll': 'Collapse all',
} as const;

const zh: Record<keyof typeof en, string> = {
  'scripts.eyebrow': '脚本库',
  'scripts.description': '仪表盘已发现的所有脚本，按所属脚本源分组。',
  'scripts.loadingSources': '正在加载脚本源…',
  'scripts.noSources.title': '尚未配置脚本源',
  'scripts.noSources.description':
    '脚本源就是存放脚本的目录：既可以是一个已共享给容器的文件夹，也可以是一个需要同步的 GitHub 仓库。只要源存在，脚本就会出现在这里。',
  'scripts.addSource': '添加脚本源',
  'scripts.source': '脚本源',
  'scripts.sync': '同步',
  'scripts.noSelection.title': '未选择脚本',
  'scripts.noSelection.description': '在目录树中选一个脚本，即可查看它的参数、源码，以及运行表单。',
  'scripts.chooseSource': '选择一个脚本源以查看其中的脚本。',
  'scripts.loadingTree': '正在加载目录树…',

  'scripts.loadingScript': '正在加载脚本…',
  'scripts.refresh': '刷新',
  'scripts.panel.source': '源码',
  'scripts.panel.run': '运行设置',
  'scripts.panel.facts': '基本信息',
  'scripts.panel.metadata': '元数据',
  'scripts.dialog.facts.description':
    '上次同步为该文件记录的完整信息：大小、来源路径，以及读取时对应的内容哈希。',
  'scripts.dialog.metadata.description': '脚本的展示方式与运行方式。改动只影响之后的运行，不影响历史记录。',
  'scripts.dialog.run.description':
    '选择目标主机，填写脚本需要的参数，然后启动。填过的值会为下次记住。',
  'scripts.runNow': '立即运行',
  'scripts.runNowTitle': '使用该脚本已保存的设置，在 {target} 上立即运行',
  'scripts.unsavedChanges': '有未保存的改动',
  'scripts.unreadable.title': '文件读不出来',
  'scripts.unreadable.description':
    '脚本已经登记，但无法从共享目录读取其内容。请重新同步脚本源，或确认该目录已挂载。',
  'scripts.field.format': '格式',
  'scripts.field.size': '大小',
  'scripts.field.interpreter': '解释器',
  'scripts.field.timeout': '超时',
  'scripts.field.sourcePath': '源路径',
  'scripts.field.discovered': '发现时间',
  'scripts.field.contentHash': '内容哈希',
  'scripts.field.displayName': '显示名称',
  'scripts.field.description': '描述',
  'scripts.field.timeoutSec': '超时（秒）',
  'scripts.field.interpreterHint': '例如 bash -eu',
  'scripts.auto': '自动',
  'scripts.noChanges': '没有改动',

  'scripts.source.lines': '共 {count} 行',
  'scripts.source.overflow': '显示前 {shown} 行，共 {total} 行',

  'scripts.filter.label': '脚本',
  'scripts.filter.clear': '清除脚本筛选',
  'scripts.filter.placeholder': '按脚本筛选…',
  'scripts.filter.searching': '搜索中…',
  'scripts.filter.noMatch': '没有匹配“{query}”的脚本。',

  'scripts.tree.expandAll': '全部展开',
  'scripts.tree.collapseAll': '全部收起',
};

export const scriptsMessages = { en, zh };
