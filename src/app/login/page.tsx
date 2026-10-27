'use client';

// Минимальная страница входа (Фаза 1). Frontend доработает оформление.
import { useState, type FormEvent } from 'react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = new URLSearchParams(window.location.search).get('next') ?? undefined;
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
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-[var(--text-2)]">
          Пароль
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            maxLength={256}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--text)]"
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
          className="h-11 rounded-lg bg-[var(--accent)] font-semibold text-[var(--accent-ink)] disabled:opacity-60"
        >
          Войти
        </button>
      </form>
    </main>
  );
}
