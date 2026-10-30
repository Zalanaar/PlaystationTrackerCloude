'use client';

// Вход (Фаза 20.2): основной способ Google, пароль владельца свёрнут как аварийный вход.
import { useState, type FormEvent } from 'react';
import { loginErrorText } from './model';

export function LoginForm({ error: errorCode, next: nextParam }: { error?: string; next?: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const urlError = loginErrorText(errorCode);
  const googleHref = nextParam ? `/api/auth/google?next=${encodeURIComponent(nextParam)}` : '/api/auth/google';
  const [open, setOpen] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = nextParam;
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, next }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        window.location.assign(json.data.redirectTo);
        return;
      }
      setError(json?.error?.message ?? 'Не удалось войти.');
    } catch {
      setError('Не удалось войти.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold text-[var(--text)]">PS Tracker</h1>
      {urlError && (
        <p role="alert" data-testid="login-error" className="rounded-lg border border-[var(--danger)] bg-[var(--surface)] p-3 text-sm text-[var(--text)]">
          {urlError}
        </p>
      )}
      <a
        href={googleHref}
        className="flex h-11 items-center justify-center rounded-lg bg-[var(--accent)] font-semibold text-[var(--accent-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        Войти через Google
      </a>
      <p className="text-sm text-[var(--text-2)]">Вход только для приглашённых. Доступ выдаёт владелец.</p>

      <details
        open={open}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
      >
        <summary className="cursor-pointer text-sm text-[var(--text-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
          Аварийный вход владельца
        </summary>
        <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-[var(--text-2)]">
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[var(--text)]"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="h-11 rounded-lg border border-[var(--border-strong)] font-semibold text-[var(--text)] disabled:opacity-60"
          >
            Войти по паролю
          </button>
        </form>
      </details>
    </main>
  );
}
