/**
 * The sign-in screen, which is the only page reachable without a session.
 *
 * The wordmark above the form is absent on purpose: "scriptdashboard" is the
 * product's name, and a name is not translated.
 */

const en = {
  'auth.tagline': 'Sign in to continue. These are the credentials configured on the server.',
  'auth.username': 'Username',
  'auth.password': 'Password',
  'auth.submit': 'Sign in',
} as const;

const zh: Record<keyof typeof en, string> = {
  'auth.tagline': '请登录后继续。凭据由服务端配置。',
  'auth.username': '用户名',
  'auth.password': '密码',
  'auth.submit': '登录',
};

export const authMessages = { en, zh };
