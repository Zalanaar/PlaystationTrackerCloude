'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastItem = { id: number; text: string; kind: 'info' | 'error'; action?: { label: string; run: () => void } };
type Push = (t: { text: string; kind?: 'info' | 'error'; action?: ToastItem['action'] }) => void;

const Ctx = createContext<Push>(() => {});
export const useToast = () => useContext(Ctx);

const TTL_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>((t) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-2), { id, text: t.text, kind: t.kind ?? 'info', action: t.action }]);
    setTimeout(() => dismiss(id), t.kind === 'error' ? TTL_MS * 2 : TTL_MS);
  }, [dismiss]);
  const value = useMemo(() => push, [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="ps-toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="ps-toast" role={t.kind === 'error' ? 'alert' : 'status'} data-kind={t.kind}>
            <span>{t.text}</span>
            {t.action && (
              <button type="button" className="ps-toast__action" onClick={() => { t.action?.run(); dismiss(t.id); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
