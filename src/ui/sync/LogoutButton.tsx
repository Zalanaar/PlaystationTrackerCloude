'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }
  return (
    <button
      type="button"
      onClick={() => void logout()}
      disabled={busy}
      className="h-11 rounded-md border border-border-strong px-4 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
    >
      Выйти
    </button>
  );
}
