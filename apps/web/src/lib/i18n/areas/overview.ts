/**
 * The overview screen: the counts strip, the recent runs, and the panel beside
 * them.
 *
 * The tile and quick-link labels are spelled out here rather than borrowed from
 * `nav.*`, because these are a count and a destination hint rather than the
 * sidebar's way in -- a language that shortens a navigation label should not
 * shorten a stat.
 */

const en = {
  'overview.eyebrow': 'Dashboard',
  'overview.title': 'Overview',
  'overview.description': 'What is configured, what is running, and what just broke.',
  'overview.runScript': 'Run a script',

  // -- the counts strip ------------------------------------------------------
  'overview.count.targets': 'Targets',
  'overview.count.sources': 'Sources',
  'overview.count.scripts': 'Scripts',
  'overview.count.running': 'Running',
  'overview.count.failed': 'Failed 24h',

  // -- recent runs -----------------------------------------------------------
  'overview.recentRuns': 'Recent runs',
  'overview.allRuns': 'All runs',
  'overview.noRunsTitle': 'No runs yet',
  'overview.noRunsBody':
    'Pick a script and send it to a target; every execution lands here with its full output.',
  'overview.chooseScript': 'Choose a script',

  // -- the panel on the right ------------------------------------------------
  'overview.gettingStarted': 'Getting started',
  'overview.jumpTo': 'Jump to',
  'overview.stepTargetTitle': 'Add a target',
  'overview.stepTargetBody':
    'Where the scripts run: host, credentials and the host path of the shared directory.',
  'overview.stepSourceTitle': 'Add a source',
  'overview.stepSourceBody':
    'Where the scripts live: a local directory or a GitHub repository to sync.',
  'overview.stepRunTitle': 'Run something',
  'overview.stepRunBody': 'Once both exist, scripts appear in the tree and can be executed.',
  'overview.quickScripts': 'Scripts',
  'overview.quickScriptsHint': 'Browse and run',
  'overview.quickRunning': 'Running now',
  'overview.quickRunningHint': 'Live output',
  'overview.quickFailed': 'Failed runs',
  'overview.quickFailedHint': 'Last 24h first',
  'overview.quickTargets': 'Targets',
  'overview.quickTargetsHint': 'Hosts and credentials',
  'overview.quickSources': 'Sources',
  'overview.quickSourcesHint': 'Sync and re-scan',
} as const;

const zh: Record<keyof typeof en, string> = {
  'overview.eyebrow': '仪表盘',
  'overview.title': '总览',
  'overview.description': '当前配置了什么、正在运行什么，以及刚刚出了什么问题。',
  'overview.runScript': '运行脚本',

  'overview.count.targets': '目标主机',
  'overview.count.sources': '脚本源',
  'overview.count.scripts': '脚本',
  'overview.count.running': '运行中',
  'overview.count.failed': '24 小时失败',

  'overview.recentRuns': '最近运行',
  'overview.allRuns': '全部运行',
  'overview.noRunsTitle': '还没有运行记录',
  'overview.noRunsBody': '选一个脚本发到目标主机；每次执行都会连同完整输出出现在这里。',
  'overview.chooseScript': '选择脚本',

  'overview.gettingStarted': '快速开始',
  'overview.jumpTo': '快速跳转',
  'overview.stepTargetTitle': '添加目标主机',
  'overview.stepTargetBody': '脚本在哪里运行：主机、凭据，以及共享目录在主机上的路径。',
  'overview.stepSourceTitle': '添加脚本源',
  'overview.stepSourceBody': '脚本存放在哪里：本地目录，或需要同步的 GitHub 仓库。',
  'overview.stepRunTitle': '开始运行',
  'overview.stepRunBody': '两者都配好之后，脚本会出现在目录树里，可以直接执行。',
  'overview.quickScripts': '脚本',
  'overview.quickScriptsHint': '浏览并运行',
  'overview.quickRunning': '正在运行',
  'overview.quickRunningHint': '实时输出',
  'overview.quickFailed': '失败的运行',
  'overview.quickFailedHint': '最近 24 小时优先',
  'overview.quickTargets': '目标主机',
  'overview.quickTargetsHint': '主机与凭据',
  'overview.quickSources': '脚本源',
  'overview.quickSourcesHint': '同步并重新扫描',
};

export const overviewMessages = { en, zh };
