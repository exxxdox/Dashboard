/**
 * The IPv6 DNS console, in both languages.
 *
 * The vocabulary maps at the bottom mirror unions in `@dashboard/shared`, and
 * `lib/dns.ts` is what turns them into functions. Keeping the words here rather
 * than in that module is the point of this file: the server reports codes and
 * nothing in the UI ever renders one.
 */

const en = {
  'dns.eyebrow': 'DNS',
  'dns.title': 'IPv6 DNS',

  'dns.action.detect': 'Detect address',
  'dns.action.query': 'Query record',
  'dns.action.checkAndUpdate': 'Check and update',

  'dns.lastCheck.title': 'Last check',
  'dns.stat.publicIpv6': 'Public IPv6',
  'dns.stat.detectedAt': 'Detected at',
  'dns.stat.provider': 'Provider',
  'dns.stat.record': 'Record',
  'dns.stat.queriedAt': 'Queried at',
  'dns.stat.schedule': 'Schedule',
  'dns.value.notDetected': 'Not detected yet',
  'dns.value.notQueried': 'Not queried yet',
  'dns.value.notConfigured': 'Not configured',
  'dns.schedule.off': 'Off',
  'dns.schedule.every': 'Every {minutes} min',
  'dns.schedule.next': 'next {when}',

  'dns.noRecord':
    'The provider has no AAAA record for this name yet. A check creates one on Cloudflare; Alibaba Cloud is never allowed to create one.',

  'dns.result.title': 'Result',
  'dns.result.notificationFailed':
    'The record was updated, but the Gotify notification could not be sent.',

  'dns.settings.title': 'Settings',
  'dns.history.title': 'History',

  // -- settings form -------------------------------------------------------
  'dns.form.provider': 'Provider',
  'dns.form.providerHint': "Only the selected provider's credentials are required.",
  'dns.form.cloudflareToken': 'Cloudflare API token',
  'dns.form.cloudflareTokenHint': 'Needs permission to edit DNS records in this zone.',
  'dns.form.zoneId': 'Zone ID',
  'dns.form.recordName': 'Record name',
  'dns.form.recordNameHint': 'The full name, e.g. home.example.com.',
  'dns.form.alibabaAccessKeyId': 'Access key ID',
  'dns.form.alibabaAccessKeySecret': 'Access key secret',
  'dns.form.alibabaRecordId': 'Record ID',
  'dns.form.alibabaRecordIdHint':
    "Alibaba Cloud updates by record id and never creates one, so it has to exist already. Its host record and type come from the provider's own answer, not from here.",
  'dns.form.scheduleEnable': 'Check on a schedule',
  'dns.form.interval': 'Interval (minutes)',
  'dns.form.intervalHint': 'A check that finds the same address writes nothing.',
  'dns.form.save': 'Save settings',
  'dns.form.saved': 'Settings saved.',
  'dns.form.cleared': '{name} cleared.',
  'dns.form.blockedClear': 'The selected provider still needs this credential.',

  // -- the settings dialog -------------------------------------------------
  'dns.action.settings': 'Settings',
  'dns.settings.summaryConfigured': '{provider} · every {minutes} min',
  'dns.settings.summaryOff': '{provider} · schedule off',
  'dns.settings.summaryUnconfigured': 'Not configured yet',

  // -- history -------------------------------------------------------------
  'dns.history.checks': 'Checks',
  'dns.history.succeeded': 'Succeeded',
  'dns.history.failed': 'Failed',
  'dns.history.changed': 'Changed',
  'dns.history.lastChange': 'Last change',
  'dns.history.empty.title': 'No checks yet',
  'dns.history.empty.description':
    'Every manual and scheduled check is recorded here, including the ones that failed.',
  'dns.history.column.ran': 'Ran',
  'dns.history.column.source': 'Source',
  'dns.history.column.result': 'Result',
  'dns.history.column.address': 'Address',
  'dns.history.column.previous': 'Previous',
  'dns.history.column.why': 'Why',
  'dns.history.newer': 'Newer',
  'dns.history.older': 'Older',
  'dns.history.viewAll': 'View all',
  'dns.history.allTitle': 'All checks',
  'dns.history.allDescription': 'Every manual and scheduled check, newest first.',
  'dns.history.range': '{from}–{to} of {total}',
  'dns.history.label': 'DNS checks',

  // -- vocabulary ----------------------------------------------------------
  'dns.resultLabel.created': 'Created',
  'dns.resultLabel.updated': 'Updated',
  'dns.resultLabel.unchanged': 'No change',
  'dns.resultLabel.failed': 'Failed',

  'dns.source.manual': 'Manual',
  'dns.source.scheduled': 'Scheduled',

  'dns.provider.cloudflare': 'Cloudflare',
  'dns.provider.alibaba': 'Alibaba Cloud',

  'dns.failure.not_configured': 'Nothing has been configured yet.',
  'dns.failure.invalid_settings':
    'The saved settings are incomplete, so no check was attempted.',
  'dns.failure.ipv6_detect_failed': 'The public IPv6 probe could not be reached.',
  'dns.failure.ipv6_not_global':
    'The detected address is not a public one, so nothing was written.',
  'dns.failure.dns_query_failed': 'The provider could not be asked for the current record.',
  'dns.failure.dns_write_failed': 'The provider rejected the write.',
  'dns.failure.record_missing':
    'The provider has no record with that id, and this console never creates one.',
  'dns.failure.record_identity_missing':
    'The queried record has no host name, so there was nothing to update.',

  'dns.update.created': 'Created {where}, pointing at {ipv6}.',
  'dns.update.updated': 'Updated {where} from {previous} to {ipv6}.',
  'dns.update.unchanged': '{where} already points at {ipv6}; nothing was written.',
  'dns.update.failed': 'The check failed.',
  'dns.update.emptyValue': '(empty)',
  'dns.update.theRecord': 'the record',
} as const;

const zh: Record<keyof typeof en, string> = {
  'dns.eyebrow': 'DNS',
  'dns.title': 'IPv6 DNS',

  'dns.action.detect': '探测地址',
  'dns.action.query': '查询记录',
  'dns.action.checkAndUpdate': '检查并更新',

  'dns.lastCheck.title': '最近一次检查',
  'dns.stat.publicIpv6': '公网 IPv6',
  'dns.stat.detectedAt': '探测时间',
  'dns.stat.provider': '服务商',
  'dns.stat.record': '解析记录',
  'dns.stat.queriedAt': '查询时间',
  'dns.stat.schedule': '定时任务',
  'dns.value.notDetected': '尚未探测',
  'dns.value.notQueried': '尚未查询',
  'dns.value.notConfigured': '未配置',
  'dns.schedule.off': '已关闭',
  'dns.schedule.every': '每 {minutes} 分钟',
  'dns.schedule.next': '下次 {when}',

  'dns.noRecord':
    '服务商上还没有这个域名的 AAAA 记录。Cloudflare 会由检查自动创建；阿里云则永远不会创建。',

  'dns.result.title': '执行结果',
  'dns.result.notificationFailed': '记录已更新，但 Gotify 通知发送失败。',

  'dns.settings.title': '设置',
  'dns.history.title': '历史记录',

  'dns.form.provider': '服务商',
  'dns.form.providerHint': '只需填写所选服务商的凭据。',
  'dns.form.cloudflareToken': 'Cloudflare API 令牌',
  'dns.form.cloudflareTokenHint': '需要该区域 DNS 记录的编辑权限。',
  'dns.form.zoneId': '区域 ID',
  'dns.form.recordName': '记录名',
  'dns.form.recordNameHint': '完整域名，例如 home.example.com。',
  'dns.form.alibabaAccessKeyId': 'AccessKey ID',
  'dns.form.alibabaAccessKeySecret': 'AccessKey Secret',
  'dns.form.alibabaRecordId': '记录 ID',
  'dns.form.alibabaRecordIdHint':
    '阿里云按记录 ID 更新，且从不创建记录，因此该记录必须已存在。主机记录与记录类型取自服务商的返回结果，不在这里填写。',
  'dns.form.scheduleEnable': '按计划自动检查',
  'dns.form.interval': '检查间隔（分钟）',
  'dns.form.intervalHint': '若检查发现地址未变，则不会写入任何内容。',
  'dns.form.save': '保存设置',
  'dns.form.saved': '设置已保存。',
  'dns.form.cleared': '已清除{name}。',
  'dns.form.blockedClear': '当前选中的服务商仍需要该凭据。',

  'dns.action.settings': '设置',
  'dns.settings.summaryConfigured': '{provider} · 每 {minutes} 分钟',
  'dns.settings.summaryOff': '{provider} · 定时任务已关闭',
  'dns.settings.summaryUnconfigured': '尚未配置',

  'dns.history.checks': '检查次数',
  'dns.history.succeeded': '成功',
  'dns.history.failed': '失败',
  'dns.history.changed': '已变更',
  'dns.history.lastChange': '最近变更',
  'dns.history.empty.title': '还没有检查记录',
  'dns.history.empty.description': '每一次手动和自动检查都会记录在这里，包括失败的。',
  'dns.history.column.ran': '时间',
  'dns.history.column.source': '来源',
  'dns.history.column.result': '结果',
  'dns.history.column.address': '地址',
  'dns.history.column.previous': '原值',
  'dns.history.column.why': '原因',
  'dns.history.newer': '更新',
  'dns.history.older': '更早',
  'dns.history.viewAll': '查看全部',
  'dns.history.allTitle': '全部检查记录',
  'dns.history.allDescription': '所有手动与自动检查，最新的在最前。',
  'dns.history.range': '第 {from}–{to} 条，共 {total} 条',
  'dns.history.label': 'DNS 检查记录',

  'dns.resultLabel.created': '已创建',
  'dns.resultLabel.updated': '已更新',
  'dns.resultLabel.unchanged': '无变化',
  'dns.resultLabel.failed': '失败',

  'dns.source.manual': '手动',
  'dns.source.scheduled': '自动',

  'dns.provider.cloudflare': 'Cloudflare',
  'dns.provider.alibaba': '阿里云',

  'dns.failure.not_configured': '尚未配置任何内容。',
  'dns.failure.invalid_settings': '已保存的设置不完整，因此没有执行检查。',
  'dns.failure.ipv6_detect_failed': '无法访问公网 IPv6 探测服务。',
  'dns.failure.ipv6_not_global': '探测到的地址不是公网地址，因此没有写入任何内容。',
  'dns.failure.dns_query_failed': '无法向服务商查询当前记录。',
  'dns.failure.dns_write_failed': '服务商拒绝了写入请求。',
  'dns.failure.record_missing': '服务商上没有该 ID 对应的记录，而本控制台不会创建记录。',
  'dns.failure.record_identity_missing': '查询到的记录没有主机名，因此没有可更新的目标。',

  'dns.update.created': '已创建 {where}，指向 {ipv6}。',
  'dns.update.updated': '已将 {where} 从 {previous} 更新为 {ipv6}。',
  'dns.update.unchanged': '{where} 已指向 {ipv6}，未写入任何内容。',
  'dns.update.failed': '检查失败。',
  'dns.update.emptyValue': '（空）',
  'dns.update.theRecord': '该记录',
};

export const dnsMessages = { en, zh };
