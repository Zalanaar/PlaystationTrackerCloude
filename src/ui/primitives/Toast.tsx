'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';

type ToastItem = { id: number; text: string; kind: 'info' | 'error' | 'warning'; alert?: boolean; action?: { label: string; run: () => void } };
/** ttl: время показа в мс (по умолчанию 4 с, ошибки 8 с); длиннее для откатов массовых действий. */
/** Возвращает id тоста: по нему вызывающий может закрыть тост (useToastDismiss). */
type Push = (t: { text: string; kind?: ToastItem['kind']; alert?: boolean; action?: ToastItem['action']; ttl?: number }) => number;

const Ctx = createContext<Push>(() => 0);
const DismissCtx = createContext<(id: number) => void>(() => {});
export const useToast = () => useContext(Ctx);
export const useToastDismiss = () => useContext(DismissCtx);

const TTL_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>((t) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-2), { id, text: t.text, kind: t.kind ?? 'info', alert: t.alert, action: t.action }]);
    setTimeout(() => dismiss(id), t.ttl ?? (t.kind === 'error' ? TTL_MS * 2 : TTL_MS));
    return id;
  }, [dismiss]);
  const value = useMemo(() => push, [push]);
  // Портал в body: .ps-app изолирует стек (decor.css), иначе тост с «Отменить» оказывается под окном игры
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  return (
    <Ctx.Provider value={value}>
      <DismissCtx.Provider value={dismiss}>
      {children}
      {mounted && createPortal(
        <div className="ps-toasts" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className="ps-toast" role={t.kind === 'error' || t.alert ? 'alert' : 'status'} data-kind={t.kind}>
              <span className="ps-toast__msg">{t.alert && <Icon name="circle-alert" size={16} />}{t.text}</span>
              {t.action && (
                <button type="button" className="ps-toast__action" onClick={() => { t.action?.run(); dismiss(t.id); }}>
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
      </DismissCtx.Provider>
    </Ctx.Provider>
  );
}

const noopSubscribe = () => () => {};
