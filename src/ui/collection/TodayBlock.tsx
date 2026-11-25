'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { todayOpenCookie } from '@/shared/today-open';
import { Icon } from '../icons';

export type TodayBits = {
  month?: string;
  hunt?: string;
  inbox?: string;
  recap?: string;
  wrapped?: string;
  week1?: string;
};

type TodaySummary = TodayBits & { set: (key: string, patch: TodayBits | null) => void };

const TodayCtx = createContext<TodaySummary | null>(null);

function TodaySummaryProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Record<string, TodayBits>>({});
  const set = useCallback((key: string, patch: TodayBits | null) => {
    setSlots((prev) => {
      if (patch == null) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      const cur = prev[key];
      if (cur && JSON.stringify(cur) === JSON.stringify(patch)) return prev;
      return { ...prev, [key]: patch };
    });
  }, []);
  const merged = useMemo(() => {
    const out: TodayBits = {};
    for (const b of Object.values(slots)) Object.assign(out, b);
    return out;
  }, [slots]);
  const value = useMemo(() => ({ ...merged, set }), [merged, set]);
  return <TodayCtx.Provider value={value}>{children}</TodayCtx.Provider>;
}

/** Дочерние карточки сообщают строку свёртки (месяц, охота, повод). Без провайдера — no-op. */
export function useTodayBits(id: string, bits: TodayBits) {
  const ctx = useContext(TodayCtx);
  const set = ctx?.set;
  const json = JSON.stringify(bits);
  useEffect(() => {
    if (!set) return;
    set(id, JSON.parse(json) as TodayBits);
    return () => set(id, null);
  }, [set, id, json]);
}

function pickReason(bits: TodayBits, check: string | undefined): string | undefined {
  return bits.inbox || bits.recap || bits.wrapped || bits.week1 || check;
}

function TodayInner({
  openSsr, playingCount, checkReason, strip, side, children,
}: {
  openSsr: boolean;
  playingCount: number | null;
  checkReason?: string;
  strip?: ReactNode;
  side?: ReactNode;
  children: ReactNode;
}) {
  const bits: TodayBits = useContext(TodayCtx) ?? {};
  const [open, setOpen] = useState(openSsr);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    document.cookie = todayOpenCookie(next);
  };
  const reason = open ? undefined : pickReason(bits, checkReason);
  const parts: string[] = ['Сегодня'];
  if (playingCount != null && playingCount > 0) parts.push(`Играю ${playingCount}`);
  if (bits.month) parts.push(bits.month);
  if (bits.hunt) parts.push(`🏆${bits.hunt}`);
  const label = parts.join(' · ');
  const fullLabel = reason ? `${label} · ${reason}` : label;

  return (
    <section className="ps-today" data-open={open || undefined} data-testid="today-block">
      <div className="ps-today__row">
      <button
        type="button"
        className="ps-today__bar"
        aria-expanded={open}
        aria-controls="today-panel"
        data-testid="today-toggle"
        onClick={toggle}
      >
        <span className="ps-today__line">
          <span className="ps-today__k">Сегодня</span>
          {playingCount != null && playingCount > 0 && (
            <>
              <span className="ps-today__sep" aria-hidden="true">·</span>
              <span>Играю {playingCount}</span>
            </>
          )}
          {bits.month && (
            <>
              <span className="ps-today__sep" aria-hidden="true">·</span>
              <span className="num">{bits.month}</span>
            </>
          )}
          {bits.hunt && (
            <>
              <span className="ps-today__sep" aria-hidden="true">·</span>
              <span className="num">🏆{bits.hunt}</span>
            </>
          )}
          {reason && (
            <>
              <span className="ps-today__sep" aria-hidden="true">·</span>
              <span className="ps-today__reason">
                <i className="ps-today__dot" aria-hidden="true" />
                <span className="ps-today__reason-t">{reason}</span>
              </span>
            </>
          )}
        </span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} className="ps-today__chev" />
        <span className="ps-sr">{open ? 'Свернуть' : 'Развернуть'}. {fullLabel}</span>
      </button>
      {side}
      </div>
      {!open && strip}
      <div className="ps-today__panel" id="today-panel" hidden={!open}>
        <div className="ps-today__body">{children}</div>
      </div>
    </section>
  );
}

/**
 * Сворачиваемый блок «Сегодня» на главной: одна строка под шапкой, фильтры сразу под ней.
 * Состояние в cookie (SSR), раскрытие — карточки компактно. Повод (точка + текст) не увеличивает высоту строки.
 */
export function TodayBlock({
  openSsr, playingCount, checkReason, strip, side, children,
}: {
  openSsr: boolean;
  playingCount: number | null;
  checkReason?: string;
  /** Справа от строки (П.3: «Разбор N»). */
  side?: ReactNode;
  /** Обложки «Играю» под свёрнутой строкой (в раскрытом виде их показывает hero). */
  strip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <TodaySummaryProvider>
      <TodayInner openSsr={openSsr} playingCount={playingCount} checkReason={checkReason} strip={strip} side={side}>{children}</TodayInner>
    </TodaySummaryProvider>
  );
}
