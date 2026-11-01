'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { GameItem } from '@/server/collection/types';
import type { WrappedResponse } from '@/server/wrapped/types';
import { Cover } from '../collection/Cover';
import { cssUrl, plural } from '../format';
import { Icon, PlatinumIcon, StatusGlyph } from '../icons';
import { Avatar } from '../primitives/Avatar';
import { useMediaQuery } from '../primitives/hooks';
import { RareIcon } from '../stats/RareTrophies';
import { RARE_SLIDE_TITLE, rareRows } from '../stats/rare';
import { hourBars, hourLabel, patternHeadline, patternReady, patternSlideLabel, PATTERN_CAPTION, trophiesCount, weekdayBars, WEEKDAY_NOM, type PatternBar } from '../stats/playPattern';
import {
  allEstimateBadge, allRangeText, busiestBars, dayMonthYear, firstGameCaption, platinumRows, slideTitle, yearsAgoText, yearsWord,
  estimateBadge, approxHours, cascadeDelay, classifyGesture, counterValue, daysText, gamesText, genreShare, hoursText, inMonth, isAutoAdvance,
  keyAction, launchesLabel, parseDurationMs, partialBadge, resolveSlides, segmentFill, slideCover, stepIndex,
  syncStartedText, tickTimer, trophiesText, COUNTER_MS, HOLD_MS, TIMER_START, type Dir, type StorySlideId, type TimerState,
} from './model';

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function WrappedStory({ data, onClose }: { data: WrappedResponse; onClose: () => void }) {
  const slides = useMemo(() => resolveSlides(data), [data]);
  const count = slides.length;
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [mounted, setMounted] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const fillRef = useRef<HTMLSpanElement | null>(null);
  const gesture = useRef<{ x: number; y: number; t: number; timer: ReturnType<typeof setTimeout> | null } | null>(null);

  const slide = slides[index];
  const isAll = data.scope === 'all';
  const auto = isAutoAdvance({ reducedMotion: reduced, index, count, slide });
  const autoRef = useRef(auto);
  useEffect(() => { autoRef.current = auto; }, [auto]);
  useEffect(() => { pausedRef.current = held; }, [held]);

  const go = useCallback((dir: Dir) => setIndex((i) => stepIndex(i, dir, count)), [count]);

  // портал после монтирования (SSR не рисует историю)
  useEffect(() => { const t = setTimeout(() => setMounted(true), 0); return () => clearTimeout(t); }, []);

  // фокус: запомнить, перевести в диалог, вернуть; блокировка прокрутки страницы
  useEffect(() => {
    if (!mounted) return;
    const prev = document.activeElement as HTMLElement | null;
    root.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [mounted]);

  // таймер сегмента: rAF, чистый шаг tickTimer; пауза по удержанию и скрытой вкладке
  useEffect(() => {
    if (!mounted) return;
    const duration = parseDurationMs(getComputedStyle(document.documentElement).getPropertyValue('--dur-slide'));
    let state: TimerState = TIMER_START;
    let last = performance.now();
    let raf = 0;
    fillRef.current?.style.setProperty('--p', autoRef.current ? '0' : '1');
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      const paused = pausedRef.current || document.hidden;
      const r = tickTimer(state, dt, { duration, paused, auto: autoRef.current });
      state = r.state;
      fillRef.current?.style.setProperty('--p', String(autoRef.current ? state.elapsed / duration : 1));
      if (r.done) { go('next'); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mounted, index, go]);

  // клавиатура и ловушка фокуса
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const items = Array.from(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0];
        const lastEl = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === root.current || !root.current?.contains(active))) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && (active === lastEl || !root.current?.contains(active))) { e.preventDefault(); first.focus(); }
        return;
      }
      const onButton = (e.target as HTMLElement | null)?.closest?.('button, a') != null;
      const a = keyAction({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, onButton });
      if (!a) return;
      e.preventDefault();
      if (a === 'close') onClose(); else go(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, go, onClose]);

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* не критично */ }
    const timer = setTimeout(() => setHeld(true), HOLD_MS);
    gesture.current = { x: e.clientX, y: e.clientY, t: performance.now(), timer };
  };
  const finish = (e: RPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (g.timer) clearTimeout(g.timer);
    setHeld(false);
    if (cancelled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const r = classifyGesture({
      dx: e.clientX - g.x, dy: e.clientY - g.y, durationMs: performance.now() - g.t, x: e.clientX - rect.left, width: rect.width,
    });
    if (r.kind === 'tap' || r.kind === 'swipe') go(r.dir);
  };

  if (!mounted) return null;

  const rm = reduced;
  return createPortal(
    <div className="ps-story" data-reduced={rm || undefined}>
      <div
        ref={root} className="ps-story__stage" role="dialog" aria-modal="true" aria-label={isAll ? 'Итоги за всё время' : `Итоги ${data.year}`} tabIndex={-1}
        data-slide={slide} data-index={index} data-paused={held || undefined} data-auto={auto || undefined}
        onContextMenu={(e) => e.preventDefault()} onPointerDown={onDown} onPointerUp={(e) => finish(e, false)} onPointerCancel={(e) => finish(e, true)}
      >
        <Backdrop data={data} id={slide} />
        <div className="ps-story__top">
          <div className="ps-story__bars" aria-hidden="true">
            {slides.map((s, i) => (
              <span key={`${s}-${i}`} className="ps-story__seg" data-state={i < index ? 'done' : i === index ? 'cur' : 'todo'}>
                <span ref={i === index ? fillRef : undefined} className="ps-story__fill" style={{ '--p': segmentFill(i, index, 0, auto) } as CSSProperties} />
              </span>
            ))}
          </div>
          <div className="ps-story__head">
            <span className="ps-story__brand">PS TRACKER · {isAll ? 'ВСЁ ВРЕМЯ' : data.year}</span>
            <button type="button" className="ps-story__close" aria-label="Закрыть итоги" onClick={onClose}><Icon name="x" size={20} /></button>
          </div>
        </div>
        <div className="ps-story__body" key={index}>
          <SlideView id={slide} data={data} rm={rm} index={index} count={count} onClose={onClose} onRestart={() => setIndex(0)} />
        </div>
        <p className="ps-sr" role="status" aria-live="polite">{`Слайд ${index + 1} из ${count}. ${slideTitle(slide, isAll ? 'all' : 'year')}`}</p>
      </div>
    </div>,
    document.body,
  );
}

function Backdrop({ data, id }: { data: WrappedResponse; id: StorySlideId }) {
  const c = slideCover(id, data);
  const url = cssUrl(c?.url);
  return (
    <div className="ps-story__bg" aria-hidden="true">
      {url && <div className="ps-story__art" style={{ backgroundImage: url }} />}
      <div className="ps-story__shade" />
      <div className="ps-story__scrim" />
    </div>
  );
}

/** Элемент каскада: fade + translateY, задержка n * 80 мс (при reduced-motion без задержки и анимации). */
function Rise({ n, rm, className, children }: { n: number; rm: boolean; className?: string; children: ReactNode }) {
  return <div className={`ps-story__rise ${className ?? ''}`} style={{ animationDelay: `${cascadeDelay(n, rm)}ms` }}>{children}</div>;
}

function Counter({ target, rm, approx }: { target: number; rm: boolean; approx?: boolean }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (rm) return;
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const e = now - t0;
      setV(counterValue(e, target));
      if (e < COUNTER_MS) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, rm]);
  const shown = rm ? target : v;
  return (
    <span className="ps-story__num ps-num">
      <span className="ps-sr">{approx ? 'примерно ' : ''}{hoursText(target)}</span>
      {approx && <span className="ps-story__approx" aria-hidden="true">≈</span>}
      <span aria-hidden="true">{hoursText(shown)}</span>
    </span>
  );
}

function Thumb({ g, w, dropped }: { g: GameItem; w: number; dropped?: boolean }) {
  return (
    <div className="ps-story__thumb" style={{ width: w, filter: dropped ? 'saturate(.5)' : undefined }} title={g.title}>
      <Cover url={g.coverUrl} title={g.title} />
    </div>
  );
}

function SlideView({
  id, data, rm, index, count, onClose, onRestart,
}: { id: StorySlideId; data: WrappedResponse; rm: boolean; index: number; count: number; onClose: () => void; onRestart: () => void }) {
  const year = data.year;
  const all = data.scope === 'all';
  const range = all ? allRangeText(data) : null;
  switch (id) {
    case 'start':
      return (
        <div className="ps-story__center">
          {(data.profile.onlineId || data.profile.avatarUrl) && (
            <Rise n={0} rm={rm}><Avatar url={data.profile.avatarUrl} name={data.profile.onlineId} size={96} className="ps-story__avatar" /></Rise>
          )}
          <Rise n={1} rm={rm}><p className="ps-story__label">{all ? 'Итоги за всё время' : 'Итоги года'}</p></Rise>
          <Rise n={2} rm={rm}><h2 className="ps-story__title">{all ? 'Всё время в играх' : `Твой ${year} в играх`}</h2></Rise>
          {data.profile.onlineId && <Rise n={3} rm={rm}><p className="ps-story__nick">{data.profile.onlineId}</p></Rise>}
          {all && range && <Rise n={4} rm={rm}><p className="ps-story__small ps-num">{range}</p></Rise>}
        </div>
      );
    case 'hours': {
      const total = data.hours.total ?? 0;
      const days = daysText(data.hours.days);
      const top = data.hours.topMonth;
      return (
        <div className="ps-story__col">
          <Rise n={0} rm={rm}><p className="ps-story__label">Ты наиграл</p></Rise>
          <Rise n={1} rm={rm}><div className="ps-story__big"><Counter target={total} rm={rm} approx={data.hours.hasEstimate} /><span className="ps-story__unit">ч</span></div></Rise>
          {days && <Rise n={2} rm={rm}><p className="ps-story__sub">{days}</p></Rise>}
          {top && <Rise n={3} rm={rm}><p className="ps-story__label">Больше всего {inMonth(top.month)}: {hoursText(top.hours)} ч</p></Rise>}
          {data.hours.hasEstimate
            ? <Rise n={4} rm={rm}><p className="ps-story__badge" data-kind="estimate">{all ? allEstimateBadge(data.firstSnapshotDate, data.allTime?.hoursByYear.unattributed) : estimateBadge(data.firstSnapshotDate)}</p></Rise>
            : data.periodPartial && <Rise n={4} rm={rm}><p className="ps-story__badge">{partialBadge(data.firstSnapshotDate)}</p></Rise>}
        </div>
      );
    }
    case 'topGames':
      return (
        <div className="ps-story__col">
          <Rise n={0} rm={rm}><h2 className="ps-story__title">Топ игр года</h2></Rise>
          <ol className="ps-story__top5">
            {data.topGames.items.slice(0, 5).map((it, i) => (
              <li key={it.game.id} data-first={it.rank === 1 || undefined}>
                <Rise n={i + 1} rm={rm} className="ps-story__toprow">
                  <span className="ps-story__rank ps-num">{it.rank}</span>
                  <Thumb g={it.game} w={it.rank === 1 ? 96 : 56} />
                  <span className="ps-story__gname">
                    <b>{it.game.title}</b>
                    <span className="ps-num" aria-label={it.estimated ? `примерно ${hoursText(it.hours)} ч` : undefined}>{approxHours(it.hours, it.estimated)} ч</span>
                  </span>
                </Rise>
              </li>
            ))}
          </ol>
        </div>
      );
    case 'finished': {
      const f = data.finished;
      const bm = f.busiestMonth;
      return (
        <div className="ps-story__col">
          <Rise n={0} rm={rm}><h2 className="ps-story__title">Пройдено и брошено</h2></Rise>
          <Rise n={1} rm={rm} className="ps-story__frow">
            <StatusGlyph status="completed" size={40} />
            <span className="ps-story__stat ps-num" aria-label={`Пройдено: ${f.completed.count}`}>{f.completed.count}</span>
            <span className="ps-story__covers">{f.completed.items.slice(0, 4).map((x) => <Thumb key={x.game.id} g={x.game} w={56} />)}</span>
          </Rise>
          <Rise n={2} rm={rm} className="ps-story__frow">
            <StatusGlyph status="dropped" size={40} />
            <span className="ps-story__stat ps-num" aria-label={`Брошено: ${f.dropped.count}`}>{f.dropped.count}</span>
            <span className="ps-story__covers">{f.dropped.items.slice(0, 3).map((x) => <Thumb key={x.game.id} g={x.game} w={56} dropped />)}</span>
          </Rise>
          {bm && (
            <Rise n={3} rm={rm}>
              <p className="ps-story__label">Больше всего {inMonth(bm.month)}</p>
              <p className="ps-story__sub ps-num">{gamesText(bm.count)}</p>
            </Rise>
          )}
        </div>
      );
    }
    case 'trophies': {
      const c = data.trophies.counts;
      const rare = data.trophies.platinum.rarest;
      return (
        <div className="ps-story__col">
          <Rise n={0} rm={rm}><p className="ps-story__label">Трофеев получено</p></Rise>
          <Rise n={1} rm={rm}><div className="ps-story__big ps-num">{c.total}</div></Rise>
          <Rise n={2} rm={rm} className="ps-story__frow">
            <span style={{ color: 'var(--platinum)', display: 'inline-flex' }}><Icon name="trophy" size={40} /></span>
            <span className="ps-story__stat ps-num">{c.platinum}</span>
            <span className="ps-story__sub">{plural(c.platinum, ['платина', 'платины', 'платин'])}</span>
          </Rise>
          <Rise n={3} rm={rm} className="ps-story__tri">
            <span style={{ color: 'var(--gold)' }}><Icon name="trophy" size={20} /> <b className="ps-num">{c.gold}</b> золото</span>
            <span style={{ color: 'var(--silver)' }}><Icon name="trophy" size={20} /> <b className="ps-num">{c.silver}</b> серебро</span>
            <span style={{ color: 'var(--bronze)' }}><Icon name="trophy" size={20} /> <b className="ps-num">{c.bronze}</b> бронза</span>
          </Rise>
          {rare?.game && (
            <Rise n={4} rm={rm}>
              <p className="ps-story__label">Самая редкая платина</p>
              <p className="ps-story__sub">{rare.game.title}{rare.earnedRate !== null ? `, ${String(rare.earnedRate).replace('.', ',')}% игроков` : ''}</p>
            </Rise>
          )}
          <span className="ps-sr">{trophiesText(c.total)}</span>
        </div>
      );
    }
    case 'rareTrophies': {
      const rows = rareRows(data.trophies.rare ?? []);
      const [first, ...rest] = rows;
      if (!first) return null;
      return (
        <div className="ps-story__col ps-rares">
          <Rise n={0} rm={rm}><p className="ps-story__label">Самое редкое</p></Rise>
          <Rise n={1} rm={rm}><h2 className="ps-story__title">{RARE_SLIDE_TITLE}</h2></Rise>
          <Rise n={2} rm={rm} className="ps-rares__first">
            <RareIcon url={first.iconUrl} className="ps-rares__ic1" />
            <span className="ps-rares__pct ps-num" aria-label={`${first.rate} игроков получили этот трофей`}>{first.rate}</span>
            <span className="ps-rares__cap">игроков получили этот трофей</span>
            <b className="ps-rares__nm1">{first.name}</b>
            <span className="ps-rares__gm1">{first.gameName}</span>
            <StoryRarity row={first} />
          </Rise>
          <ol className="ps-rares__list">
            {rest.map((r, i) => (
              <li key={r.key}>
                <Rise n={i + 3} rm={rm} className="ps-rares__row">
                  <RareIcon url={r.iconUrl} />
                  <span className="ps-rares__tx"><b>{r.name}</b><small>{r.gameName}</small><StoryRarity row={r} /></span>
                  <span className="ps-rares__pct2 ps-num">{r.rate}</span>
                </Rise>
              </li>
            ))}
          </ol>
        </div>
      );
    }
    case 'genres': {
      if (all) return <AllGenresSlide data={data} rm={rm} />;
      const items = data.genres.items.slice(0, 3);
      const max = Math.max(0, ...items.map((g) => g.value));
      return (
        <div className="ps-story__col">
          <Rise n={0} rm={rm}><h2 className="ps-story__title">Любимые жанры</h2></Rise>
          {items.map((g, i) => (
            <Rise key={g.key} n={i + 1} rm={rm}>
              <div className="ps-story__genre">
                <span className="ps-story__genre-fill" style={{ width: `${Math.max(8, genreShare(g.value, max) * 100)}%` }} />
                <span className="ps-story__genre-l">{g.label}</span>
                <span className="ps-story__genre-v ps-num">≈ {gamesText(Math.max(1, Math.round(g.value)))}</span>
              </div>
            </Rise>
          ))}
        </div>
      );
    }
    case 'longestGame': {
      const l = data.longestGame;
      if (!l.game) return null;
      return (
        <div className="ps-story__center">
          <Rise n={0} rm={rm}><h2 className="ps-story__title">Самая долгая игра</h2></Rise>
          <Rise n={1} rm={rm}><div className="ps-story__hero"><Cover url={l.game.coverUrl} title={l.game.title} /></div></Rise>
          <Rise n={2} rm={rm}><p className="ps-story__gtitle">{l.game.title}</p></Rise>
          <Rise n={3} rm={rm}><p className="ps-story__sub ps-num">{approxHours(l.hours, l.estimated)} ч · {launchesLabel(l.playCount)}</p></Rise>
        </div>
      );
    }
    case 'firstGame': return <FirstGameSlide data={data} rm={rm} />;
    case 'platinumYears': {
      const p = data.allTime?.platinumByYear;
      if (!p) return null;
      const { rows, rest } = platinumRows(p.items);
      return (
        <div className="ps-story__col ps-plat">
          <Rise n={0} rm={rm}><h2 className="ps-story__title">Платины</h2></Rise>
          <Rise n={1} rm={rm}>
            <div className="ps-story__big ps-plat__big"><PlatinumIcon size={40} className="ps-plat__ic" /><span className="ps-num" aria-label={`Платин: ${p.total}`}>{p.total}</span></div>
          </Rise>
          <ol className="ps-plat__rows" aria-label="Платины по годам">
            {rows.map((r, i) => (
              <li key={r.year} className="ps-plat__row">
                <span className="ps-plat__y ps-num">{r.year}</span>
                <span className="ps-plat__track" aria-hidden="true"><i style={{ width: `${r.pct}%`, animationDelay: rm ? undefined : `${i * 60}ms` }} /></span>
                <b className="ps-plat__n ps-num">{r.count}</b>
              </li>
            ))}
          </ol>
          {rest > 0 && <Rise n={3} rm={rm}><p className="ps-story__small">и ещё {yearsWord(rest)}</p></Rise>}
        </div>
      );
    }
    case 'busiestYear': {
      const b = data.allTime?.busiestYear;
      if (!b || b.year === null) return null;
      const bars = busiestBars(data.allTime?.hoursByYear.byYear ?? [], b.year);
      return (
        <div className="ps-story__col ps-busy">
          <Rise n={0} rm={rm}><p className="ps-story__label">Самый игровой год</p></Rise>
          <Rise n={1} rm={rm}><div className="ps-story__big ps-num">{b.year}</div></Rise>
          <Rise n={2} rm={rm}>
            <p className="ps-busy__h ps-num" aria-label={`${b.estimated ? 'примерно ' : ''}${hoursText(b.hours)} ч`}>{approxHours(b.hours, b.estimated)} ч</p>
          </Rise>
          <Rise n={3} rm={rm}>
            <div className="ps-busy__bars" aria-hidden="true">
              {bars.map((x) => (
                <span key={x.year} className="ps-busy__slot" data-leader={x.leader || undefined}>
                  <i style={{ height: `${x.heightPct}%` }} />
                  <small>{x.leader ? x.year : ''}</small>
                </span>
              ))}
            </div>
          </Rise>
        </div>
      );
    }
    case 'playPattern': return <PlayPatternSlide data={data} rm={rm} />;
    case 'final':
      return (
        <div className="ps-story__center">
          <Rise n={0} rm={rm}><h2 className="ps-story__title">{all ? 'Спасибо, что играешь' : `До встречи в ${year + 1}`}</h2></Rise>
          <Rise n={1} rm={rm} className="ps-story__actions">
            <button type="button" className="ps-btn ps-story__btn" onClick={onRestart}><Icon name="refresh" size={16} />Пересмотреть</button>
            <button type="button" className="ps-btn ps-story__btn ps-story__btn--solid" onClick={onClose}>Закрыть</button>
          </Rise>
          <span className="ps-sr">{`Слайд ${index + 1} из ${count}`}</span>
        </div>
      );
    case 'empty': {
      const since = syncStartedText(data.emptyState?.syncStartedOn ?? null);
      return (
        <div className="ps-story__center">
          <Rise n={0} rm={rm}><h2 className="ps-story__title">{all ? 'Данных пока нет' : `В ${year} данных нет`}</h2></Rise>
          {since && <Rise n={1} rm={rm}><p className="ps-story__sub">{since}</p></Rise>}
          <Rise n={2} rm={rm} className="ps-story__actions">
            <button type="button" className="ps-btn ps-story__btn ps-story__btn--solid" onClick={onClose}>Закрыть</button>
          </Rise>
        </div>
      );
    }
    default:
      return null;
  }
}

/** Редкость на слайде: слово и сегменты цвета текста истории (цвета редкости на тёмном скриме не используем). */
function StoryRarity({ row }: { row: ReturnType<typeof rareRows>[number] }) {
  return (
    <span className="ps-rares__rar">
      <span>{row.rarity}</span>
      {row.rarityKnown && <span className="ps-rares__seg" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} data-on={i < row.segments || undefined} />)}</span>}
    </span>
  );
}

function AllGenresSlide({ data, rm }: { data: WrappedResponse; rm: boolean }) {
  const top = data.allTime?.topGenre;
  const items = data.genres.items;
  const lead = items[0];
  if (!top || !top.hasData || !top.label) return null;
  const max = Math.max(0, ...items.map((g) => g.value));
  const games = (v: number) => `≈ ${gamesText(Math.max(1, Math.round(v)))}`;
  return (
    <div className="ps-story__col">
      <Rise n={0} rm={rm}><p className="ps-story__label">Любимый жанр</p></Rise>
      <Rise n={1} rm={rm}><h2 className="ps-story__title ps-story__title--xl">{top.label}</h2></Rise>
      <Rise n={2} rm={rm}><p className="ps-story__sub ps-num">{games(top.value)}</p></Rise>
      <Rise n={3} rm={rm}>
        <div className="ps-story__genre ps-story__genre--lg" aria-hidden="true">
          <span className="ps-story__genre-fill ps-story__genre-fill--grow" style={{ width: `${Math.max(8, genreShare(lead?.value ?? top.value, max || top.value) * 100)}%` }} />
        </div>
      </Rise>
      {items.slice(1, 3).map((g, i) => (
        <Rise key={g.key} n={i + 4} rm={rm}><p className="ps-story__small ps-num">{g.label}, {games(g.value)}</p></Rise>
      ))}
    </div>
  );
}

function FirstGameSlide({ data, rm }: { data: WrappedResponse; rm: boolean }) {
  const f = data.allTime?.firstGame;
  const [now] = useState(() => Date.now());
  if (!f || !f.game) return null;
  const caption = firstGameCaption(f.source, f.at);
  const ago = f.source === 'first_trophy' ? null : yearsAgoText(f.at, now);
  return (
    <div className="ps-story__center">
      <Rise n={0} rm={rm}><h2 className="ps-story__title">С чего всё началось</h2></Rise>
      <div className="ps-story__rise ps-story__rise--cover" style={{ animationDelay: '0ms' }}><div className="ps-story__hero"><Cover url={f.game.coverUrl} title={f.game.title} /></div></div>
      <Rise n={2} rm={rm}><p className="ps-story__gtitle ps-story__gtitle--2" title={f.game.title}>{f.game.title}</p></Rise>
      {caption && <Rise n={3} rm={rm}><p className="ps-story__sub" aria-label={dayMonthYear(f.at) ?? undefined}>{caption}</p></Rise>}
      {ago && <Rise n={4} rm={rm}><p className="ps-story__label ps-story__label--soft">{ago}</p></Rise>}
    </div>
  );
}

function PatternBars({ bars, kind, rm }: { bars: PatternBar[]; kind: 'hours' | 'weekdays'; rm: boolean }) {
  return (
    <div className="ps-pps__chart" data-kind={kind} data-rm={rm || undefined} aria-hidden="true">
      <div className="ps-pps__bars">
        {bars.map((b) => (
          <span key={b.index} className="ps-pps__slot">
            <i data-peak={b.peak || undefined} style={{ height: `${b.heightPct}%`, animationDelay: rm ? undefined : `${(kind === 'hours' ? b.index : 24 + b.index) * 20}ms` }} />
          </span>
        ))}
      </div>
      <div className="ps-pps__lbls">
        {kind === 'hours'
          ? ['00', '06', '12', '18'].map((l) => <small key={l}>{l}</small>)
          : bars.map((b) => <small key={b.index} data-peak={b.peak || undefined}>{b.label}</small>)}
      </div>
    </div>
  );
}

function PlayPatternSlide({ data, rm }: { data: WrappedResponse; rm: boolean }) {
  const p = data.playPattern;
  if (!patternReady(p) || p.peakHour === null || p.peakWeekday === null) return null;
  const hours = hourBars(p);
  const days = weekdayBars(p);
  return (
    <div className="ps-story__col ps-pps" role="group" aria-label={patternSlideLabel(p)}>
      <Rise n={0} rm={rm}><h2 className="ps-story__title ps-pps__title">{patternHeadline(p.peakHour)}</h2></Rise>
      <Rise n={1} rm={rm}>
        <div className="ps-pps__peak ps-num" aria-hidden="true">{hourLabel(p.peakHour)}</div>
        <p className="ps-story__label ps-story__label--soft">чаще всего получаешь трофеи</p>
      </Rise>
      <PatternBars bars={hours} kind="hours" rm={rm} />
      <PatternBars bars={days} kind="weekdays" rm={rm} />
      <Rise n={3} rm={rm}><p className="ps-pps__fav">Любимый день: {(WEEKDAY_NOM[p.peakWeekday] ?? '').toLowerCase()}</p></Rise>
      <p className="ps-pps__cap ps-story__label ps-story__label--soft">{PATTERN_CAPTION}</p>
      <span className="ps-sr">{trophiesCount(p.total)}</span>
    </div>
  );
}
