/**
 * The targets page and its form.
 *
 * The strings are shaped by one fact: a target is a host, so nothing here is
 * allowed to imply the script runs locally. The working directory is not part
 * of a target any more; it belongs to the run and is chosen beside the script.
 */

const en = {
  'targets.eyebrow': 'Infrastructure',
  'targets.title': 'Targets',
  'targets.description':
    'A target is a Linux host reached over SSH. Scripts are uploaded to it and run in a working directory chosen per run.',

  'targets.add': 'Add target',
  'targets.newTitle': 'New target',
  'targets.editTitle': 'Edit {name}',
  'targets.deleteNamed': 'Delete {name}',

  'targets.empty.title': 'No targets yet',
  'targets.empty.description':
    'Add the host you want to run scripts on. Nothing can execute until one exists.',

  // -- one row -------------------------------------------------------------
  'targets.auth.key': 'key',
  'targets.auth.password': 'password',
  'targets.testConnection': 'Test connection',
  'targets.neverChecked': 'Never checked',
  'targets.ready': 'Ready',
  'targets.notReady': 'Not ready',

  // -- the result of a check ----------------------------------------------
  'targets.cannotRun': 'This target cannot run anything yet',
  'targets.fact.reachable': 'Reachable',
  'targets.fact.staging': 'Staging area',
  'targets.fact.ok': 'ok',
  'targets.fact.failed': 'failed',
  // Follows the `setsid` token, which is why it starts mid-sentence.
  'targets.setsidNote':
    'is missing on this host. Cancelling a run kills only the top-level process, so anything it spawned may keep running.',

  // -- the form ------------------------------------------------------------
  'targets.form.name': 'Name',
  'targets.form.namePlaceholder': 'prod-01',
  'targets.form.username': 'Username',
  'targets.form.usernamePlaceholder': 'deploy',
  'targets.form.host': 'Host',
  'targets.form.hostPlaceholder': '10.0.0.12 or host.example.com',
  'targets.form.port': 'Port',
  'targets.form.auth': 'Authentication',
  'targets.form.privateKey': 'Private key',
  'targets.form.password': 'Password',
  'targets.form.privateKeyHintNew': 'PEM text, including the BEGIN/END lines.',
  'targets.form.privateKeyHintEdit': 'Leave blank to keep the stored key.',
  'targets.form.keyPlaceholder': '-----BEGIN OPENSSH PRIVATE KEY-----',
  'targets.form.passphrase': 'Passphrase',
  'targets.form.passphraseHint': 'Only if the key is encrypted.',
  'targets.form.passwordHintEdit': 'Leave blank to keep the stored password.',
  'targets.form.unchanged': 'unchanged',
  'targets.form.connectTimeout': 'Connect timeout',
  'targets.form.connectTimeoutHint': 'Seconds to wait for the SSH handshake.',

  'targets.form.required': 'Required',
  'targets.form.save': 'Save target',
  'targets.form.cancel': 'Cancel',
} as const;

const zh: Record<keyof typeof en, string> = {
  'targets.eyebrow': '基础设施',
  'targets.title': '目标主机',
  'targets.description':
    '目标主机是通过 SSH 连接的 Linux 主机。脚本会上传到该主机，并在每次运行时选择的工作目录中运行。',

  'targets.add': '添加目标主机',
  'targets.newTitle': '新建目标主机',
  'targets.editTitle': '编辑 {name}',
  'targets.deleteNamed': '删除 {name}',

  'targets.empty.title': '还没有目标主机',
  'targets.empty.description': '添加要运行脚本的主机。在添加之前，任何脚本都无法执行。',

  'targets.auth.key': '密钥',
  'targets.auth.password': '密码',
  'targets.testConnection': '测试连接',
  'targets.neverChecked': '从未检查',
  'targets.ready': '就绪',
  'targets.notReady': '未就绪',

  'targets.cannotRun': '该目标主机暂时无法运行任何脚本',
  'targets.fact.reachable': '可连接',
  'targets.fact.staging': '暂存目录',
  'targets.fact.ok': '正常',
  'targets.fact.failed': '失败',
  'targets.setsidNote':
    '在这台主机上不可用。取消运行只能结束顶层进程，它启动的子进程可能仍在运行。',

  'targets.form.name': '名称',
  'targets.form.namePlaceholder': 'prod-01',
  'targets.form.username': '用户名',
  'targets.form.usernamePlaceholder': 'deploy',
  'targets.form.host': '主机',
  'targets.form.hostPlaceholder': '10.0.0.12 或 host.example.com',
  'targets.form.port': '端口',
  'targets.form.auth': '身份验证',
  'targets.form.privateKey': '私钥',
  'targets.form.password': '密码',
  'targets.form.privateKeyHintNew': 'PEM 文本，包含 BEGIN/END 行。',
  'targets.form.privateKeyHintEdit': '留空则保留已保存的私钥。',
  'targets.form.keyPlaceholder': '-----BEGIN OPENSSH PRIVATE KEY-----',
  'targets.form.passphrase': '私钥口令',
  'targets.form.passphraseHint': '仅在私钥已加密时需要填写。',
  'targets.form.passwordHintEdit': '留空则保留已保存的密码。',
  'targets.form.unchanged': '保持不变',
  'targets.form.connectTimeout': '连接超时',
  'targets.form.connectTimeoutHint': '等待 SSH 握手的秒数。',

  'targets.form.required': '必填',
  'targets.form.save': '保存目标主机',
  'targets.form.cancel': '取消',
};

export const targetsMessages = { en, zh };
