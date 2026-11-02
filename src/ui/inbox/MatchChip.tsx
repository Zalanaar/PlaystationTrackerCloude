'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { fetchMatches } from '../collection/manualApi';
import { MatchSheet } from './MatchSheet';

/**
 * Чип «Это та игра? N» на странице «Бэклог» (Фаза 43): полосы «С прошлого визита» здесь нет, а подтверждение нужно рядом со списком.
 * Число берётся из GET /api/manual-games/matches; нет вопросов или сбой = чипа нет.
 */
export function MatchChip({ className, onChanged }: { className?: string; onChanged: () => void }) {
  const [n, setN] = useState(0);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let alive = true;
    fetchMatches().then((r) => { if (alive) setN(r.matches.length); }, () => {});
    return () => { alive = false; };
  }, []);
  if (n <= 0 && !open) return null;
  return (
    <div className={className}>
      <button
        ref={btn} type="button" className="ps-chipbtn ps-match-chip" data-testid="inbox-match" aria-haspopup="dialog" aria-label={`Это та игра? Совпадений: ${n}`}
        onClick={() => setOpen(true)}
      >
        <Icon name="circle-help" size={16} />
        <span>Это та игра? <b className="num">{n}</b></span>
        <Icon name="chevron-right" size={14} />
      </button>
      {open && <MatchSheet onClose={() => setOpen(false)} onRemaining={setN} onChanged={onChanged} />}
    </div>
  );
}
