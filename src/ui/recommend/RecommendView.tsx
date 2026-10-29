'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import '../recommend.css';
import { BacklogMode } from './BacklogMode';
import { DiscoverMode } from './DiscoverMode';
import { candidatesText, MODE_OPTIONS, MODE_SUB_DISCOVER, pageHref, parseMode, parseTime, type ModeValue, type TimeValue } from './model';

/**
 * Экран «Подскажи» (/recommend): оболочка с переключателем режимов (`?mode=discover`, спека 13b п.15.1).
 * Режим монтируется при первом выборе и дальше остаётся в памяти (скрыт), поэтому его последний ответ показывается сразу.
 * Режим «Новое от ИИ» не запрашивает данные, пока не выбран (запрос стоит лимита ИИ).
 */
export function RecommendView() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setModeState] = useState<ModeValue>(() => parseMode(params.get('mode')));
  const [visited, setVisited] = useState<ReadonlySet<ModeValue>>(() => new Set([parseMode(params.get('mode'))]));
  const [candidates, setCandidates] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const modeRef = useRef(mode);
  const timeRef = useRef(parseTime(params.get('time')));

  // чужие и лишние параметры убираются: `?mode=backlog`, неизвестный режим, `time` в режиме «Новое от ИИ»
  useEffect(() => {
    const raw = params.get('mode');
    const wantsClean = (raw !== null && raw !== 'discover') || (parseMode(raw) === 'discover' && params.get('time') !== null);
    if (!wantsClean) return;
    const m = parseMode(raw);
    if (m === 'discover') timeRef.current = 'any';
    router.replace(pageHref(m, timeRef.current), { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- нормализация адреса только при открытии страницы
  }, []);

  const pick = useCallback((m: ModeValue) => {
    if (m === modeRef.current) return;
    modeRef.current = m;
    setModeState(m);
    setVisited((s) => new Set(s).add(m));
    setAnnounce(`Режим: ${MODE_OPTIONS.find((o) => o.value === m)?.label ?? ''}`);
    router.replace(pageHref(m, timeRef.current), { scroll: false });
  }, [router]);

  // текущее время бэклога держим для адреса при возврате в режим
  const onTime = useCallback((t: TimeValue) => { timeRef.current = t; }, []);

  const onKey = (e: KeyboardEvent, i: number) => {
    const n = MODE_OPTIONS.length;
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    pick(MODE_OPTIONS[to].value);
    radios.current[to]?.focus();
  };

  const sub = mode === 'discover' ? MODE_SUB_DISCOVER : candidates !== null ? candidatesText(candidates) : null;

  return (
    <div className="ps-rec-page">
      <div className="ps-pagehead ps-rec-head">
        <h1 className="ps-h1">Подскажи</h1>
        {sub && <p className="ps-rec-sub">{sub}</p>}
      </div>
      <div className="ps-seg ps-rec-modes" role="radiogroup" aria-label="Режим подсказок">
        {MODE_OPTIONS.map((o, i) => (
          <button
            key={o.value} type="button" role="radio" aria-checked={mode === o.value} tabIndex={mode === o.value ? 0 : -1}
            ref={(el) => { radios.current[i] = el; }} onClick={() => pick(o.value)} onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="ps-rec-sr" aria-live="polite">{announce}</div>
      {visited.has('backlog') && <BacklogMode active={mode === 'backlog'} onCandidates={setCandidates} onTime={onTime} />}
      {visited.has('discover') && <DiscoverMode active={mode === 'discover'} onBacklog={() => pick('backlog')} />}
    </div>
  );
}
