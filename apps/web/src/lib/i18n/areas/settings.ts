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
    'Where the dashboard reaches you. A notification is sent only when something actually changed, and never in place of doing the work.',
  'settings.notifications.addressLabel': 'Gotify address',
  'settings.notifications.addressHint':
    'Host or full URL. A bare host is assumed to be https.',
  'settings.notifications.addressPlaceholder': 'notify.example.com',
  'settings.notifications.tokenLabel': 'Gotify token',
  'settings.notifications.tokenHint': 'An application token from Gotify, not your account password.',
  'settings.notifications.test': 'Send test message',
  'settings.notifications.testHint': 'Uses what is in the boxes above, saved or not.',
  'settings.notifications.testSent': 'Test message sent.',
  'settings.notifications.saved': 'Settings saved.',
  'settings.notifications.cleared': 'Stored token deleted.',
  'settings.notifications.state.ready': 'Ready',
  'settings.notifications.state.incomplete': 'Incomplete',
  'settings.notifications.state.off': 'Off',
  'settings.notifications.stateHint.ready': 'An address and a token are both stored.',
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
    '仪表盘向你发送消息的通道。只有内容真正发生变化时才会通知，通知也永远不会代替实际执行。',
  'settings.notifications.addressLabel': 'Gotify 地址',
  'settings.notifications.addressHint': '主机名或完整 URL。只写主机名时按 https 处理。',
  'settings.notifications.addressPlaceholder': 'notify.example.com',
  'settings.notifications.tokenLabel': 'Gotify 令牌',
  'settings.notifications.tokenHint': 'Gotify 的应用令牌，不是账号密码。',
  'settings.notifications.test': '发送测试消息',
  'settings.notifications.testHint': '直接使用上方输入框中的内容，无论是否已保存。',
  'settings.notifications.testSent': '测试消息已发送。',
  'settings.notifications.saved': '设置已保存。',
  'settings.notifications.cleared': '已删除保存的令牌。',
  'settings.notifications.state.ready': '已就绪',
  'settings.notifications.state.incomplete': '不完整',
  'settings.notifications.state.off': '未启用',
  'settings.notifications.stateHint.ready': '地址与令牌均已保存。',
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
