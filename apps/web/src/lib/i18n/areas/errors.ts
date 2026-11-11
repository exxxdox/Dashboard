/**
 * The server's messages, in the reader's language.
 *
 * Every key here has a counterpart on the server -- `lib/errors.ts` and the
 * sites that throw -- because that is the contract: the server names a fact and
 * the client chooses the words. A server message with no key is shown as the
 * English the server sent, which is why this is partial coverage by design
 * rather than an oversight.
 *
 * `error.field.*` is addressed by an identifier rather than by a sentence: the
 * DNS settings problem sends `['cloudflareZoneId', …]` and the interpolation in
 * `lib/i18n/index.tsx` resolves each one here.
 */

const en = {
  'error.notFound': '{entity} not found',
  'error.auth.badCredentials': 'That username and password do not match',
  'error.auth.rateLimited': 'Too many attempts. Try again later.',
  'error.auth.signInRequired': 'Sign in to continue',
  'error.crossSite': 'Cross-site requests are not accepted',
  'error.featureDisabled': 'This feature is disabled. Enable it in Settings.',
  'error.scripts.bashOnly': 'Only Bash (.sh) scripts are supported.',
  'error.validationFailed': 'The request did not match the expected shape',
  'error.internal': 'An unexpected error occurred',
  'error.shuttingDown': 'The server is shutting down',
  'error.schedule.cron': 'Enter a valid five-field Cron expression with a future trigger.',
  'error.schedule.timeZone': 'Enter a valid IANA time zone, such as Asia/Shanghai or UTC.',
  'error.schedule.params': 'One or more saved run parameters are invalid.',
  'error.schedule.duplicateName': 'A schedule with this name already exists. Choose another name.',
  'error.entity.target': 'Target',
  'error.entity.source': 'Source',
  'error.entity.script': 'Script',
  'error.entity.execution': 'Execution',
  'error.entity.schedule': 'Schedule',
  'error.entity.record': 'Record',

  'error.dns.missingCredentials': 'The selected provider still needs: {fields}',
  'error.dns.intervalTooSmall': 'The check interval must be at least {min} minute',
  'error.dns.intervalTooLarge': 'The check interval must be at most {max} minutes',
  'error.notification.notConfigured':
    'A Gotify address and token are both needed to send a test message',

  'error.field.cloudflareToken': 'Cloudflare API token',
  'error.field.cloudflareZoneId': 'Cloudflare zone id',
  'error.field.cloudflareRecordName': 'Cloudflare record name',
} as const;

const zh: Record<keyof typeof en, string> = {
  'error.notFound': '找不到{entity}',
  'error.auth.badCredentials': '用户名或密码不正确',
  'error.auth.rateLimited': '尝试次数过多，请稍后再试。',
  'error.auth.signInRequired': '请先登录',
  'error.crossSite': '不接受跨站请求',
  'error.featureDisabled': '此功能已关闭，请先在设置中启用。',
  'error.scripts.bashOnly': '仅支持 Bash（.sh）脚本。',
  'error.validationFailed': '请求内容与预期格式不符',
  'error.internal': '发生了未预期的错误',
  'error.shuttingDown': '服务正在关闭',
  'error.schedule.cron': '请输入有效的五字段 Cron 表达式，且包含未来的触发时间。',
  'error.schedule.timeZone': '请输入有效的 IANA 时区，例如 Asia/Shanghai 或 UTC。',
  'error.schedule.params': '部分已保存的运行参数无效。',
  'error.schedule.duplicateName': '计划名称已存在，请使用其他名称。',
  'error.entity.target': '目标主机',
  'error.entity.source': '脚本源',
  'error.entity.script': '脚本',
  'error.entity.execution': '运行记录',
  'error.entity.schedule': '定时计划',
  'error.entity.record': '记录',

  'error.dns.missingCredentials': '所选服务商仍缺少：{fields}',
  'error.dns.intervalTooSmall': '检查间隔至少为 {min} 分钟',
  'error.dns.intervalTooLarge': '检查间隔最多为 {max} 分钟',
  'error.notification.notConfigured': '发送测试消息需要同时填写 Gotify 地址和令牌',

  'error.field.cloudflareToken': 'Cloudflare API 令牌',
  'error.field.cloudflareZoneId': 'Cloudflare 区域 ID',
  'error.field.cloudflareRecordName': 'Cloudflare 记录名',
};

export const errorMessages = { en, zh };
