import { useState, type FormEvent } from 'react';
import { LogIn } from 'lucide-react';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/Feedback';
import { Field, TextInput } from '../components/Form';
import { useLogin } from '../api/queries';
import { errorMessage } from '../api/client';
import { useI18n } from '../lib/i18n';

/**
 * The sign-in screen: the only page reachable without a session.
 *
 * Credentials live in state for as long as the request takes and are never
 * written to storage. They are not ours to keep, and the session cookie the
 * server returns is what persists.
 */
export function SignInPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (username === '' || password === '') return;
    login.mutate({ username, password });
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="flex items-center gap-3">
          <span className="bg-accent shadow-glow h-8 w-1 shrink-0 rounded-full" aria-hidden />
          <span className="mono text-brand font-semibold tracking-tight">
            <span className="text-mute">script</span>
            <span className="text-ink">dashboard</span>
          </span>
        </div>

        <p className="text-mute text-meta mt-3">{t('auth.tagline')}</p>

        <div className="mt-5 grid gap-3">
          <Field label={t('auth.username')}>
            {({ id }) => (
              <TextInput
                id={id}
                className="mono"
                value={username}
                autoComplete="username"
                autoFocus
                onChange={(event) => setUsername(event.target.value)}
              />
            )}
          </Field>

          <Field label={t('auth.password')}>
            {({ id }) => (
              <TextInput
                id={id}
                type="password"
                className="mono"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
        </div>

        {login.isError ? (
          <div className="mt-3">
            <ErrorBanner message={errorMessage(login.error, i18n)} />
          </div>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          className="mt-5 w-full justify-center"
          icon={<LogIn className="size-4" aria-hidden />}
          loading={login.isPending}
          disabled={username === '' || password === ''}
        >
          {t('auth.submit')}
        </Button>
      </form>
    </main>
  );
}
