'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import '../recommend.css';
import { Icon } from '../icons';
import { isGoneOrDone } from '../collection/manual';
import { answerMatch, fetchMatches } from '../collection/manualApi';
import { Sheet } from '../primitives/Sheet';
import { useToast } from '../primitives/Toast';
import { formatNumber } from '../format';
import { MatchCard, type MatchBusy } from './MatchCard';
import { MATCH_PAGE, matchToast, visibleMatches, type ManualMatch } from './match';

type Phase = 'loading' | 'error' | 'ready';

/** Лист «Подтверди совпадения» (§19.6): карточки «Это та игра?». Пустой список закрывает лист. */
export function MatchSheet({
  onClose, onRemaining, onChanged,
}: { onClose: () => void; onRemaining: (n: number) => void; onChanged: () => void }) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('loading');
  const [list, setList] = useState<ManualMatch[]>([]);
  const [shown, setShown] = useState(MATCH_PAGE);
  const [busy, setBusy] = useState<Record<number, MatchBusy>>({});
  const [errs, setErrs] = useState<Record<number, boolean>>({});
  const [live, setLive] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setPhase('loading');
    try {
      const r = await fetchMatches();
      if (my !== seq.current) return;
      setList(r.matches);
      onRemaining(r.matches.length);
      setPhase('ready');
      if (r.matches.length === 0) onClose();
    } catch {
      if (my === seq.current) setPhase('error');
    }
    // onRemaining/onClose стабильны для листа на время его жизни
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    // seq: счётчик запросов, а не DOM-узел; нужен текущий, чтобы отбросить поздний ответ после закрытия
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { clearTimeout(t); seq.current++; };
  }, [load]);

  async function answer(m: ManualMatch, a: 'yes' | 'no') {
    setBusy((b) => ({ ...b, [m.id]: a }));
    setErrs((e) => ({ ...e, [m.id]: false }));
    try {
      await answerMatch(m.id, a);
    } catch (e) {
      // уже решено или связано (404/409) считается успехом
      if (!isGoneOrDone(e)) {
        setBusy((b) => ({ ...b, [m.id]: null }));
        setErrs((x) => ({ ...x, [m.id]: true }));
        return;
      }
    }
    const idx = list.findIndex((x) => x.id === m.id);
    const next = list.filter((x) => x.id !== m.id);
    setList(next);
    setBusy((b) => ({ ...b, [m.id]: null }));
    onRemaining(next.length);
    onChanged();
    toast({ text: matchToast(a, m) });
    setLive(`Осталось ${next.length}`);
    if (next.length === 0) {
      onClose();
      return;
    }
    requestAnimationFrame(() => {
      const cards = bodyRef.current?.querySelectorAll<HTMLElement>('[data-testid="match-card"]');
      const target = cards?.[Math.min(idx, (cards?.length ?? 1) - 1)]?.querySelector<HTMLElement>('button');
      (target ?? bodyRef.current?.querySelector<HTMLElement>('[data-testid="match-close"]'))?.focus();
    });
  }

  const any = Object.values(busy).some((b) => b);
  return (
    <Sheet open onClose={onClose} title="Подтверди совпадения" className="ps-match-sheet" busy={any}>
      <div className="ps-match-wrap" ref={bodyRef}>
        <p className="ps-sheet__sub">Мы нашли игры в твоей библиотеке PSN, похожие на те, что ты добавил вручную («не куплено» или с другой платформы). Подтверди, одна ли это игра.</p>
        <p className="ps-sr" aria-live="polite">{live}</p>
        <div className="ps-match-body">
          {phase === 'loading' && (
            <ul className="ps-match-list" aria-busy="true" aria-label="Загрузка совпадений">
              {[0, 1].map((i) => <li key={i} className="ps-skeleton ps-match-sk" aria-hidden="true" />)}
            </ul>
          )}
          {phase === 'error' && (
            <div className="ps-rec-banner" role="alert">
              <Icon name="circle-alert" size={16} />
              <span>Не удалось загрузить совпадения.</span>
              <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => void load()}><Icon name="refresh" size={14} />Повторить</button>
            </div>
          )}
          {phase === 'ready' && (
            <>
              <ul className="ps-match-list" aria-label="Совпадения">
                {visibleMatches(list, shown).map((m) => (
                  <MatchCard key={m.id} match={m} busy={busy[m.id] ?? null} error={!!errs[m.id]} onAnswer={(a) => void answer(m, a)} />
                ))}
              </ul>
              {list.length > shown && (
                <button type="button" className="ps-btn ps-match__more" onClick={() => setShown((n) => n + MATCH_PAGE)}>
                  Показать ещё ({formatNumber(list.length - shown)})
                </button>
              )}
            </>
          )}
        </div>
        <div className="ps-match-foot">
          <button type="button" className="ps-btn ps-btn--ghost" data-testid="match-close" disabled={any} onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </Sheet>
  );
}
