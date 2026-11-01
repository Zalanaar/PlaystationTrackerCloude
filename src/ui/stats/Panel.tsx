import type { ReactNode, Ref } from 'react';

/** Панель блока Статистики (§4.11): заголовок, подзаголовок, необязательная «aside» (легенда). */
export function Panel({
  title, sub, className, labelId, aside, children, panelRef, busy,
}: { title: string; sub?: string; className?: string; labelId: string; aside?: ReactNode; children: ReactNode; panelRef?: Ref<HTMLElement>; busy?: boolean }) {
  return (
    <section ref={panelRef} className={`ps-panel ps-st-panel ${className ?? ''}`} aria-labelledby={labelId} aria-busy={busy || undefined}>
      <h3 className="ps-st-panel__t" id={labelId}>{title}</h3>
      {sub && <p className="ps-st-panel__s">{sub}</p>}
      {aside}
      {children}
    </section>
  );
}
