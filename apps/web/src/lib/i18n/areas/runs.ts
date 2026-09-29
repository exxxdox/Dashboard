/**
 * The runs area: the history list, one run's detail page, and the run form.
 *
 * This file also owns the status vocabulary in `lib/status.ts`. Those words
 * belong to an execution, and the run pages are where they are read; the target,
 * source and overview pages only pass a status through to the same label
 * component, so their wording lives here too rather than being invented a second
 * time somewhere else.
 */

const en = {
  // -- execution status labels, produced by `lib/status.ts` ----------------
  'runs.status.queued': 'Queued',
  'runs.status.running': 'Running',
  'runs.status.succeeded': 'Succeeded',
  'runs.status.failed': 'Failed',
  'runs.status.canceled': 'Canceled',
  'runs.status.timedOut': 'Timed out',
  'runs.status.interrupted': 'Interrupted',

  // -- sync status labels, shown beside a source or a script tree ----------
  'runs.sync.never': 'Never synced',
  'runs.sync.syncing': 'Syncing',
  'runs.sync.ok': 'Synced',
  'runs.sync.error': 'Sync failed',

  // -- the history list ----------------------------------------------------
  'runs.eyebrow': 'Executions',
  'runs.description': 'Every execution, newest first.',
  'runs.refresh': 'Refresh',
  'runs.hint.move': 'move',
  'runs.hint.search': 'search',
  'runs.hint.open': 'open',
  'runs.hint.back': 'back',

  'runs.filter.status': 'Filter by status',
  'runs.filter.allStatuses': 'All statuses',
  'runs.filter.target': 'Filter by target',
  'runs.filter.allTargets': 'All targets',
  'runs.count.one': '{count} run',
  'runs.count.many': '{count} runs',

  'runs.empty.filtered.title': 'No runs match these filters',
  'runs.empty.filtered.description': 'Loosen the filters, or clear them to see every execution.',
  'runs.empty.filtered.action': 'Clear filters',
  'runs.empty.none.title': 'No runs yet',
  'runs.empty.none.description':
    'Executions appear here the moment a script is sent to a target.',
  'runs.empty.none.action': 'Run a script',

  'runs.col.run': 'Run',
  'runs.col.status': 'Status',
  'runs.col.script': 'Script',
  'runs.col.target': 'Target',
  'runs.col.exit': 'Exit',
  'runs.col.time': 'Time',
  'runs.col.queued': 'Queued',

  'runs.range': '{from}–{to} of {total}',
  'runs.previous': 'Previous',
  'runs.next': 'Next',

  // -- one run -------------------------------------------------------------
  'runs.detail.eyebrow': 'Execution',
  'runs.detail.title': 'Run {tag}',
  'runs.detail.loading': 'Loading run…',
  // A preposition with the host name styled separately, so the sentence is
  // assembled around a node the page owns.
  'runs.detail.onTarget': 'on',
  'runs.detail.cancel': 'Cancel run',
  'runs.detail.delete': 'Delete',

  'runs.stat.exitCode': 'Exit code',
  'runs.stat.duration': 'Duration',
  'runs.stat.started': 'Started',
  'runs.stat.finished': 'Finished',
  'runs.stat.output': 'Output',

  'runs.field.command': 'Command',
  'runs.field.parameters': 'Parameters',
  'runs.field.arguments': 'Arguments',
  'runs.field.target': 'Target',
  'runs.field.scriptPath': 'Script path (relative to source)',
  'runs.field.emptyArg': '(empty)',
  'runs.field.timeout': 'Timeout',

  'runs.truncated.lead': 'Output was truncated.',
  'runs.truncated.body':
    'This run produced {size} and the server cut the tail. What follows is incomplete past the cut point.',
  'runs.terminal.loading': 'Loading terminal…',

  // -- the run form --------------------------------------------------------
  'runs.error.pickTarget': 'Pick a target',
  'runs.error.required': 'Required',
  'runs.error.number': 'Expected a number',
  'runs.paramName.required': 'Name required',
  'runs.paramName.invalid': 'Not a valid parameter name',
  'runs.paramName.reserved': 'The runner sets this variable',
  'runs.paramName.declared': 'Already declared above',
  'runs.paramName.duplicate': 'Already set above',

  'runs.target.loading': 'Loading targets…',
  'runs.target.none': 'No targets configured',
  'runs.noTargets.lead': 'A run needs somewhere to run.',
  'runs.noTargets.link': 'Add a target',
  'runs.noTargets.tail': 'first.',

  'runs.param.required': 'required',
  'runs.param.default': 'default {value}',
  'runs.noParams':
    'This script declares no parameters, so the list below is the whole form: anything added there reaches it as an environment variable or a positional argument.',
  'runs.timeout.hint': "Seconds. Blank uses the script's own limit.",
  'runs.timeout.hintOwn': "Seconds. Blank uses the script's own limit ({seconds}s).",

  'runs.custom.title': 'Custom parameters',
  'runs.custom.nameLabel': 'Custom parameter {index} name',
  'runs.custom.argLabel': 'Custom argument {index} label',
  'runs.custom.modeLabel': 'Custom parameter {index} mode',
  'runs.custom.valueLabel': 'Custom parameter {index} value',
  'runs.custom.remove': 'Remove parameter {index}',
  'runs.custom.labelPlaceholder': 'label (optional)',
  'runs.custom.valuePlaceholder': 'value',
  'runs.custom.add': 'Add parameter',
  // Assembled around the `env`, `SD_*`, `argv`, `$1` and `$2` tokens the page
  // renders as code, which is why one sentence arrives as four fragments.
  'runs.custom.envLead':
    "sets an environment variable, so its name must be a shell identifier, and the runner's own",
  'runs.custom.envTail': 'names are reserved.',
  'runs.custom.argvLead': 'is a positional argument: it reaches the script as',
  'runs.custom.argvTail':
    'in the order listed here, and its name is only a label. At most {max} in all.',

  'runs.prefill.draft': 'Restored what you last typed here.',
  'runs.prefill.lastRun': 'Filled in from the last run of this script.',

  'runs.submit': 'Run script',
  'runs.submitHint': 'Values reach the script as environment variables.',
} as const;

const zh: Record<keyof typeof en, string> = {
  'runs.status.queued': '排队中',
  'runs.status.running': '运行中',
  'runs.status.succeeded': '成功',
  'runs.status.failed': '失败',
  'runs.status.canceled': '已取消',
  'runs.status.timedOut': '超时',
  'runs.status.interrupted': '已中断',

  'runs.sync.never': '从未同步',
  'runs.sync.syncing': '同步中',
  'runs.sync.ok': '已同步',
  'runs.sync.error': '同步失败',

  'runs.eyebrow': '运行',
  'runs.description': '全部运行记录，最新的在前。',
  'runs.refresh': '刷新',
  'runs.hint.move': '移动',
  'runs.hint.search': '搜索',
  'runs.hint.open': '打开',
  'runs.hint.back': '返回',

  'runs.filter.status': '按状态筛选',
  'runs.filter.allStatuses': '全部状态',
  'runs.filter.target': '按目标主机筛选',
  'runs.filter.allTargets': '全部目标主机',
  'runs.count.one': '{count} 次运行',
  'runs.count.many': '{count} 次运行',

  'runs.empty.filtered.title': '没有符合条件的运行记录',
  'runs.empty.filtered.description': '放宽筛选条件，或清除筛选以查看全部运行记录。',
  'runs.empty.filtered.action': '清除筛选',
  'runs.empty.none.title': '暂无运行记录',
  'runs.empty.none.description': '脚本发送到目标主机后，运行记录会立即出现在这里。',
  'runs.empty.none.action': '运行脚本',

  'runs.col.run': '运行',
  'runs.col.status': '状态',
  'runs.col.script': '脚本',
  'runs.col.target': '目标主机',
  'runs.col.exit': '退出码',
  'runs.col.time': '耗时',
  'runs.col.queued': '排队',

  'runs.range': '第 {from}–{to} 条，共 {total} 条',
  'runs.previous': '上一页',
  'runs.next': '下一页',

  'runs.detail.eyebrow': '运行',
  'runs.detail.title': '运行 {tag}',
  'runs.detail.loading': '正在加载运行记录…',
  'runs.detail.onTarget': '在',
  'runs.detail.cancel': '取消运行',
  'runs.detail.delete': '删除',

  'runs.stat.exitCode': '退出码',
  'runs.stat.duration': '耗时',
  'runs.stat.started': '开始时间',
  'runs.stat.finished': '结束时间',
  'runs.stat.output': '输出',

  'runs.field.command': '命令',
  'runs.field.parameters': '参数',
  'runs.field.arguments': '位置参数',
  'runs.field.target': '目标主机',
  'runs.field.scriptPath': '脚本路径（相对于脚本源）',
  'runs.field.emptyArg': '（空）',
  'runs.field.timeout': '超时时间',

  'runs.truncated.lead': '输出已被截断。',
  'runs.truncated.body': '本次运行产生了 {size}，服务器已截去尾部，截断点之后的内容不完整。',
  'runs.terminal.loading': '正在加载终端…',

  'runs.error.pickTarget': '请选择目标主机',
  'runs.error.required': '必填',
  'runs.error.number': '应为数字',
  'runs.paramName.required': '请填写名称',
  'runs.paramName.invalid': '参数名无效',
  'runs.paramName.reserved': '该名称由运行器占用',
  'runs.paramName.declared': '上方已声明同名参数',
  'runs.paramName.duplicate': '上方已设置同名参数',

  'runs.target.loading': '正在加载目标主机…',
  'runs.target.none': '尚未配置目标主机',
  'runs.noTargets.lead': '运行需要有目标主机，请先',
  'runs.noTargets.link': '添加目标主机',
  'runs.noTargets.tail': '。',

  'runs.param.required': '必填',
  'runs.param.default': '默认 {value}',
  'runs.noParams':
    '该脚本未声明任何参数，因此下方列表就是完整表单：在那里添加的内容会以环境变量或位置参数的形式传给脚本。',
  'runs.timeout.hint': '单位秒。留空则使用脚本自身的限制。',
  'runs.timeout.hintOwn': '单位秒。留空则使用脚本自身的限制（{seconds} 秒）。',

  'runs.custom.title': '自定义参数',
  'runs.custom.nameLabel': '自定义参数 {index} 的名称',
  'runs.custom.argLabel': '自定义参数 {index} 的标签',
  'runs.custom.modeLabel': '自定义参数 {index} 的类型',
  'runs.custom.valueLabel': '自定义参数 {index} 的值',
  'runs.custom.remove': '删除参数 {index}',
  'runs.custom.labelPlaceholder': '标签（可选）',
  'runs.custom.valuePlaceholder': '值',
  'runs.custom.add': '添加参数',
  'runs.custom.envLead': '设置环境变量，因此名称必须是 shell 标识符，运行器自带的',
  'runs.custom.envTail': '名称已被占用。',
  'runs.custom.argvLead': '是位置参数：脚本按此处顺序通过',
  'runs.custom.argvTail': '读取它，名称仅作标注。两者合计最多 {max} 个。',

  'runs.prefill.draft': '已恢复你上次在这里填写的内容。',
  'runs.prefill.lastRun': '已按该脚本上次运行的内容填入。',

  'runs.submit': '运行脚本',
  'runs.submitHint': '参数以环境变量的形式传给脚本。',
};

export const runsMessages = { en, zh };
