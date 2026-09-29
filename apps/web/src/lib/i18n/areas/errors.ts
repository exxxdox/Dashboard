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
  'error.validationFailed': 'The request did not match the expected shape',
  'error.internal': 'An unexpected error occurred',
  'error.shuttingDown': 'The server is shutting down',
  'error.entity.target': 'Target',
  'error.entity.source': 'Source',
  'error.entity.script': 'Script',
  'error.entity.execution': 'Execution',
  'error.entity.record': 'Record',

  'error.dns.missingCredentials': 'The selected provider still needs: {fields}',
  'error.dns.intervalTooSmall': 'The check interval must be at least {min} minute',
  'error.dns.intervalTooLarge': 'The check interval must be at most {max} minutes',
  'error.notification.notConfigured':
    'A Gotify address and token are both needed to send a test message',

  'error.field.cloudflareToken': 'Cloudflare API token',
  'error.field.cloudflareZoneId': 'Cloudflare zone id',
  'error.field.cloudflareRecordName': 'Cloudflare record name',
  'error.field.alibabaAccessKeyId': 'Alibaba Cloud access key id',
  'error.field.alibabaAccessKeySecret': 'Alibaba Cloud access key secret',
  'error.field.alibabaRecordId': 'Alibaba Cloud record id',
} as const;

const zh: Record<keyof typeof en, string> = {
  'error.notFound': '找不到{entity}',
  'error.auth.badCredentials': '用户名或密码不正确',
  'error.auth.rateLimited': '尝试次数过多，请稍后再试。',
  'error.auth.signInRequired': '请先登录',
  'error.crossSite': '不接受跨站请求',
  'error.validationFailed': '请求内容与预期格式不符',
  'error.internal': '发生了未预期的错误',
  'error.shuttingDown': '服务正在关闭',
  'error.entity.target': '目标主机',
  'error.entity.source': '脚本源',
  'error.entity.script': '脚本',
  'error.entity.execution': '运行记录',
  'error.entity.record': '记录',

  'error.dns.missingCredentials': '所选服务商仍缺少：{fields}',
  'error.dns.intervalTooSmall': '检查间隔至少为 {min} 分钟',
  'error.dns.intervalTooLarge': '检查间隔最多为 {max} 分钟',
  'error.notification.notConfigured': '发送测试消息需要同时填写 Gotify 地址和令牌',

  'error.field.cloudflareToken': 'Cloudflare API 令牌',
  'error.field.cloudflareZoneId': 'Cloudflare 区域 ID',
  'error.field.cloudflareRecordName': 'Cloudflare 记录名',
  'error.field.alibabaAccessKeyId': '阿里云 AccessKey ID',
  'error.field.alibabaAccessKeySecret': '阿里云 AccessKey Secret',
  'error.field.alibabaRecordId': '阿里云记录 ID',
};

export const errorMessages = { en, zh };
