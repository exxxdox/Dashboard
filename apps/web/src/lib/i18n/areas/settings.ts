/**
 * The application settings page.
 *
 * Two sections today: the language, and where a notification goes. Both belong
 * to the dashboard rather than to a feature, which is the whole reason this
 * page exists next to the DNS console rather than inside it.
 */

const en = {
  'settings.eyebrow': 'Application',
  'settings.title': 'Settings',
  'settings.description':
    'Preferences that apply to the whole dashboard, on every page and for every feature.',

  'settings.language.title': 'Language',
  'settings.language.description':
    'Remembered in this browser. It changes the interface only; the log lines a server produces are not translated.',
  // No key for the language names themselves: an endonym is shown in its own
  // script and is the one string in this app that must *not* be translated.
  'settings.language.switch': 'Interface language',
  'settings.language.active': 'Current',

  'settings.notifications.title': 'Notifications',
  'settings.notifications.description':
    'Configure where notifications go and which events send them. Script results and DNS updates omit script parameters and logs.',
  'settings.notifications.scriptResults': 'Script result notifications',
  'settings.notifications.dnsChanges': 'DNS update notifications',
  'settings.notifications.eventsHint': 'Choose which events send notifications. Script results include manual and scheduled runs.',
  'settings.notifications.addressLabel': 'Gotify address',
  'settings.notifications.addressHint':
    'Host or full URL. A bare host is assumed to be https.',
  'settings.notifications.addressPlaceholder': 'notify.example.com',
  'settings.notifications.tokenLabel': 'Gotify token',
  'settings.notifications.tokenHint': 'An application token from Gotify, not your account password.',
  'settings.notifications.test': 'Send test message',
  'settings.notifications.testHint': 'Uses the current address and token, saved or not. Event switches do not affect test messages.',
  'settings.notifications.state.ready': 'Credentials ready',
  'settings.notifications.state.incomplete': 'Incomplete',
  'settings.notifications.state.off': 'Off',
  'settings.notifications.stateHint.ready': 'An address and a token are stored. Event switches decide which notifications are sent.',
  'settings.notifications.stateHint.incomplete':
    'Add the missing half, then send a test message to be sure.',
  'settings.notifications.stateHint.off': 'Nothing is stored, so no notification is sent.',
  'settings.notifications.neverSaved': 'Never saved.',
  'settings.notifications.lastSaved': 'Last saved {when}.',

  'settings.secret.saved': 'Saved',
  'settings.secret.notSet': 'Not set',
  'settings.secret.clear': 'Delete',
  'settings.secret.clearNamed': 'Delete the stored {name}',
  'settings.secret.unchanged': 'unchanged',
} as const;

const zh: Record<keyof typeof en, string> = {
  'settings.eyebrow': '应用',
  'settings.title': '设置',
  'settings.description': '作用于整个仪表盘的偏好设置，对所有页面和功能生效。',

  'settings.language.title': '语言',
  'settings.language.description':
    '记忆在当前浏览器中。仅切换界面语言，服务端输出的日志内容不会翻译。',
  'settings.language.switch': '界面语言',
  'settings.language.active': '当前',

  'settings.notifications.title': '通知',
  'settings.notifications.description':
    '统一配置通知地址，以及脚本运行结果和 DNS 更新是否通知。通知不包含脚本参数或日志。',
  'settings.notifications.scriptResults': '脚本运行结果通知',
  'settings.notifications.dnsChanges': 'DNS 更新通知',
  'settings.notifications.eventsHint': '选择需要通知的事件。脚本运行结果包含手动运行和定时运行。',
  'settings.notifications.addressLabel': 'Gotify 地址',
  'settings.notifications.addressHint': '主机名或完整 URL。只写主机名时按 https 处理。',
  'settings.notifications.addressPlaceholder': 'notify.example.com',
  'settings.notifications.tokenLabel': 'Gotify 令牌',
  'settings.notifications.tokenHint': 'Gotify 的应用令牌，不是账号密码。',
  'settings.notifications.test': '发送测试消息',
  'settings.notifications.testHint': '直接使用上方地址和令牌，无论是否已保存。测试消息不受通知开关影响。',
  'settings.notifications.state.ready': '凭据已就绪',
  'settings.notifications.state.incomplete': '不完整',
  'settings.notifications.state.off': '未启用',
  'settings.notifications.stateHint.ready': '地址与令牌均已保存，是否发送由通知开关决定。',
  'settings.notifications.stateHint.incomplete': '补齐缺少的一项，然后发送测试消息确认。',
  'settings.notifications.stateHint.off': '尚未保存任何内容，因此不会发送通知。',
  'settings.notifications.neverSaved': '从未保存。',
  'settings.notifications.lastSaved': '最近保存于 {when}。',

  'settings.secret.saved': '已保存',
  'settings.secret.notSet': '未设置',
  'settings.secret.clear': '删除',
  'settings.secret.clearNamed': '删除已保存的{name}',
  'settings.secret.unchanged': '保持不变',
};

export const settingsMessages = { en, zh };
