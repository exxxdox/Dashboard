/**
 * The targets page and its form.
 *
 * The strings are shaped by one fact: a target is a host, so nothing here is
 * allowed to imply the script runs locally. "Working directory" is spelled
 * "on host", and the note under a failed check says outright that no path has
 * to mean the same thing on both sides.
 */

const en = {
  'targets.eyebrow': 'Infrastructure',
  'targets.title': 'Targets',
  'targets.description':
    'A target is a Linux host reached over SSH. Scripts are uploaded to it and run from the working directory you configure.',

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
  'targets.fact.workDir': 'Working directory',
  'targets.fact.staging': 'Staging area',
  'targets.fact.ok': 'ok',
  'targets.fact.failed': 'failed',
  // Split around the `workDir` code token the sentence points at.
  'targets.workDirNote.before':
    'A script is uploaded to a temporary directory on the host and run from',
  'targets.workDirNote.after':
    ', so that directory has to exist. Nothing here needs to match a path in this container.',
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
  'targets.form.workDir': 'Working directory on host',
  'targets.form.workDirHint':
    'Absolute path the script runs in. It does not need to match anything in this container: the script is uploaded to a temporary directory and simply run from here, so this only has to exist. Files it reads by relative path must already live there.',
  'targets.form.workDirPlaceholder': '/srv/scripts',
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
    '目标主机是通过 SSH 连接的 Linux 主机。脚本会上传到该主机，并在你配置的工作目录中运行。',

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
  'targets.fact.workDir': '工作目录',
  'targets.fact.staging': '暂存目录',
  'targets.fact.ok': '正常',
  'targets.fact.failed': '失败',
  'targets.workDirNote.before': '脚本会上传到主机上的临时目录，并从',
  'targets.workDirNote.after': '运行，因此该目录必须存在。这里的路径不需要与容器内的任何路径一致。',
  'targets.setsidNote':
    '在这台主机上不可用。取消运行只能结束顶层进程，它启动的子进程可能仍在运行。',

  'targets.form.name': '名称',
  'targets.form.namePlaceholder': 'prod-01',
  'targets.form.username': '用户名',
  'targets.form.usernamePlaceholder': 'deploy',
  'targets.form.host': '主机',
  'targets.form.hostPlaceholder': '10.0.0.12 或 host.example.com',
  'targets.form.port': '端口',
  'targets.form.workDir': '主机上的工作目录',
  'targets.form.workDirHint':
    '脚本运行所处的绝对路径。无需与容器内的路径一致：脚本会先上传到临时目录，再从该目录运行，所以只需这个目录存在即可。脚本用相对路径读取的文件必须已经放在该目录中。',
  'targets.form.workDirPlaceholder': '/srv/scripts',
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
