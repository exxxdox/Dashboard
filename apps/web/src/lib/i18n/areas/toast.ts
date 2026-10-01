/**
 * What a toast says.
 *
 * Its own area rather than a line in each feature's file: these strings belong
 * to the feedback layer, they are read in one place, and a translator working
 * through them wants them together. The mutation that raises one names the key
 * from `api/query-client.ts`, so the pairing stays one line of code.
 *
 * The text is the confirmation, not the verb: "Host saved" rather than "Save
 * succeeded". It is written to be read in a corner of the screen, out of the
 * corner of an eye, while the person is already doing something else.
 */

const en = {
  'toast.dismiss': 'Dismiss',

  'toast.signedIn': 'Signed in',
  'toast.signedOut': 'Signed out',

  'toast.targetCreated': 'Host added',
  'toast.targetSaved': 'Host saved',
  'toast.targetDeleted': 'Host removed',
  'toast.targetChecked': 'Host check complete',

  'toast.sourceCreated': 'Source added',
  'toast.sourceSaved': 'Source saved',
  'toast.sourceDeleted': 'Source removed',
  'toast.sourceSynced': 'Source synced',

  'toast.scriptSaved': 'Script metadata saved',

  'toast.runStarted': 'Run queued',
  'toast.runCancelled': 'Cancellation requested',
  'toast.runDeleted': 'Run deleted',

  'toast.dnsSettingsSaved': 'DNS settings saved',
  'toast.dnsAddressDetected': 'Public address detected',
  'toast.dnsRecordQueried': 'Record queried',
  'toast.dnsUpdateRan': 'Update finished',

  'toast.settingsSaved': 'Settings saved',
  'toast.notificationSent': 'Test message sent',
} as const;

const zh: Record<keyof typeof en, string> = {
  'toast.dismiss': '关闭',

  'toast.signedIn': '已登录',
  'toast.signedOut': '已退出登录',

  'toast.targetCreated': '主机已添加',
  'toast.targetSaved': '主机已保存',
  'toast.targetDeleted': '主机已删除',
  'toast.targetChecked': '主机检查完成',

  'toast.sourceCreated': '脚本源已添加',
  'toast.sourceSaved': '脚本源已保存',
  'toast.sourceDeleted': '脚本源已删除',
  'toast.sourceSynced': '脚本源已同步',

  'toast.scriptSaved': '脚本信息已保存',

  'toast.runStarted': '运行已排队',
  'toast.runCancelled': '已请求取消',
  'toast.runDeleted': '运行记录已删除',

  'toast.dnsSettingsSaved': 'DNS 设置已保存',
  'toast.dnsAddressDetected': '已探测到公网地址',
  'toast.dnsRecordQueried': '记录已查询',
  'toast.dnsUpdateRan': '更新已完成',

  'toast.settingsSaved': '设置已保存',
  'toast.notificationSent': '测试消息已发送',
};

export const toastMessages = { en, zh };
