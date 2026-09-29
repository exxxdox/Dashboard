/**
 * Strings that belong to the shell rather than to a feature.
 *
 * Navigation, the controls every page repeats, and the relative-time wording
 * `lib/format.ts` produces. Kept in one place because the alternative is
 * "Retry" spelled three ways on three pages.
 */

const en = {
  // -- navigation and shell ------------------------------------------------
  'nav.main': 'Main',
  'nav.overview': 'Overview',
  'nav.scripts': 'Scripts',
  'nav.runs': 'Runs',
  'nav.targets': 'Targets',
  'nav.sources': 'Sources',
  'nav.dns': 'DNS',
  'nav.settings': 'Settings',
  'nav.home': 'Dashboard, go to overview',
  'nav.server': 'Server',
  'nav.connecting': 'Connecting…',
  'nav.apiUnreachable': 'API unreachable',
  'nav.signOut': 'Sign out',

  // -- repeated controls ---------------------------------------------------
  'common.retry': 'Retry',
  'common.loading': 'Loading',
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.saved': 'Saved',
  'common.notSet': 'Not set',
  'common.clear': 'Clear',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.copyNamed': 'Copy {name}',
  /** The noun `MonoValue` falls back to when the caller names nothing. */
  'common.value': 'value',
  'common.deleteNamed': 'Delete the stored {name}',
  'common.unchanged': 'unchanged',
  'common.close': 'Close',
  'common.show': 'Show',
  'common.hide': 'Hide',
  'common.expand': 'Expand',
  'common.collapse': 'Collapse',

  // -- generic values ------------------------------------------------------
  'common.none': '(none)',
  'common.notYet': 'Not yet',
  'common.dash': '—',
  'common.unknownError': 'Unexpected error',
  'common.networkError': 'Could not reach the server. Check that the API is running and reachable.',
  'common.httpError': 'Request failed with status {status}',
  'common.noSuchPage': 'No such page',
  'common.noSuchPageDescription': 'Nothing is routed at {path}',
  'common.notFoundTitle': 'That link does not point anywhere',
  'common.notFoundDescription':
    'The address may be mistyped, or a run may have been deleted since the link was copied.',
  'common.backToOverview': 'Back to overview',

  // -- relative time, produced by `lib/format.ts` --------------------------
  'time.justNow': 'just now',
  'time.secondsAgo': '{count}s ago',
  'time.minutesAgo': '{count}m ago',
  'time.hoursAgo': '{count}h ago',
  'time.daysAgo': '{count}d ago',
} as const;

/**
 * Every key above, spelled in Chinese.
 *
 * `Record<keyof typeof en, string>` is the whole enforcement: a key added to
 * one language and not the other will not typecheck.
 */
const zh: Record<keyof typeof en, string> = {
  'nav.main': '主导航',
  'nav.overview': '总览',
  'nav.scripts': '脚本',
  'nav.runs': '运行记录',
  'nav.targets': '目标主机',
  'nav.sources': '脚本源',
  'nav.dns': 'DNS',
  'nav.settings': '设置',
  'nav.home': '仪表盘，返回总览',
  'nav.server': '服务端',
  'nav.connecting': '连接中…',
  'nav.apiUnreachable': 'API 无法访问',
  'nav.signOut': '退出登录',

  'common.retry': '重试',
  'common.loading': '加载中',
  'common.save': '保存',
  'common.saving': '保存中…',
  'common.saved': '已保存',
  'common.notSet': '未设置',
  'common.clear': '清除',
  'common.copy': '复制',
  'common.copied': '已复制',
  'common.copyNamed': '复制{name}',
  'common.value': '内容',
  'common.deleteNamed': '删除已保存的{name}',
  'common.unchanged': '保持不变',
  'common.close': '关闭',
  'common.show': '展开',
  'common.hide': '收起',
  'common.expand': '展开',
  'common.collapse': '收起',

  'common.none': '（无）',
  'common.notYet': '尚未执行',
  'common.dash': '—',
  'common.unknownError': '发生未知错误',
  'common.networkError': '无法连接服务器，请确认 API 正在运行且可访问。',
  'common.httpError': '请求失败，状态码 {status}',
  'common.noSuchPage': '页面不存在',
  'common.noSuchPageDescription': '{path} 没有对应的页面',
  'common.notFoundTitle': '这个链接没有指向任何页面',
  'common.notFoundDescription': '地址可能输入有误，或者链接复制之后对应的运行记录已被删除。',
  'common.backToOverview': '返回总览',

  'time.justNow': '刚刚',
  'time.secondsAgo': '{count} 秒前',
  'time.minutesAgo': '{count} 分钟前',
  'time.hoursAgo': '{count} 小时前',
  'time.daysAgo': '{count} 天前',
};

export const commonMessages = { en, zh };
