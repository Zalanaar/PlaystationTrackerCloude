'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FeedLink } from './FeedLink';
import type { StatsResponse } from '@/server/stats/types';
import { formatNumber, plural } from '../format';
import { Icon, PlatinumIcon, StatusGlyph } from '../icons';
import {
  coverageNote, finishedYearRows, hasYearHours, TROPHY_STACK, trophiesWord, unattributedText, yearHoursBars, yearRange, yearTrophyBars, type TrophyKind,
} from './allTime';
import { ChartTip, useChartTip, useInViewOnce } from './chartTip';
import { formatHours } from './model';
import { Panel } from './Panel';

const SLOT_ROOMY = 44;

/** Шапка «Всё время» (§12.2 №1): как YearHeader, KPI в ряд. */
export function AllHeader({ data, years, currentYear }: { data: StatsResponse; years: readonly number[]; currentYear: number }) {
  const h = data.header;
  const approx = data.hours.estimatedHours > 0;
  return (
    <header className="ps-year ps-st-head ps-st-head--all">
      <div className="ps-year__btn" data-expanded="true">
        <h2 className="ps-year__y ps-st-head__y">Всё время</h2>
        <span className="ps-st-head__range">{yearRange(years, currentYear)}</span>
        <span className="ps-year__k">
          {h.hours === null
            ? <span title="Нет данных о часах"><b className="num">— ч</b></span>
            : approx
              ? (
                <span title="Часть часов оценена" aria-label={`Примерно ${formatHours(h.hours)} ч. Часть часов оценена`}>
                  <b className="num"><span className="ps-approx" aria-hidden="true">≈</span> {formatHours(h.hours)} ч</b>
                </span>
              )
              : <b className="num">{formatHours(h.hours)} ч</b>}
        </span>
        <span className="ps-year__k"><StatusGlyph status="completed" size={16} /><b className="num">{formatNumber(h.completed)}</b> пройдено</span>
        <span className="ps-year__k"><StatusGlyph status="dropped" size={16} /><b className="num">{formatNumber(h.dropped)}</b> брошено</span>
        <span className="ps-year__k ps-st-head__plat"><PlatinumIcon size={22} /><b className="num">{formatNumber(h.platinum)}</b> {plural(h.platinum, ['платина', 'платины', 'платин'])}</span>
      </div>
    </header>
  );
}

type Seg = { key: string; cls: string; grow: number; kind?: TrophyKind };
type Slot = {
  year: number; label: string; empty: boolean; heightPct: number; segs: Seg[]; text: string; tip: ReactNode; cur: boolean;
  /** подпись над столбцом (число часов, «≈», платина) */
  top?: ReactNode; topWide?: string; sub?: string;
};

/** Столбчатый график по годам: скролл со снапом, fade по краям, анимация при появлении, подсказка (§12.3, §12.5). */
function YearChart({ id, slots, ariaLabel, kind, panel }: { id: string; slots: Slot[]; ariaLabel: string; kind: 'hours' | 'trophies'; panel: HTMLElement | null }) {
  const { active, attachGroup, groupProps, itemProps } = useChartTip();
  const { attach: attachView, seen, instant } = useInViewOnce(id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ l: false, r: false });
  const [roomy, setRoomy] = useState(true);
  const n = slots.length;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [n]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setFade({ l: el.scrollLeft > 1, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
      setRoomy(n > 0 && el.scrollWidth / n >= SLOT_ROOMY);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', measure); ro?.disconnect(); };
  }, [n]);

  const activeSlot = active ? slots.find((s) => s.year === active?.key) : undefined;
  return (
    <div className="ps-st-ychart" data-kind={kind} data-in={seen ? (instant ? 'done' : 'go') : undefined} data-roomy={roomy || undefined} ref={attachView}>
      <div className="ps-st-yscroll" ref={scrollRef} data-fade-l={fade.l || undefined} data-fade-r={fade.r || undefined}>
        <div className="ps-st-ybars" role="group" aria-label={ariaLabel} ref={attachGroup} {...groupProps}>
          {slots.map((s, i) => s.empty ? (
            <div key={s.year} className="ps-st-yslot ps-st-yslot--empty" aria-hidden="true">
              <span className="ps-st-yslot__col" />
              <span className="ps-st-yslot__lbl" data-cur={s.cur || undefined}>{s.label}</span>
            </div>
          ) : (
            <button
              key={s.year} type="button" className="ps-st-yslot" aria-label={s.text} data-cur={s.cur || undefined} data-active={active?.key === s.year || undefined}
              style={{ '--i': i } as CSSProperties} {...itemProps(s.year)}
            >
              <span className="ps-st-yslot__col">
                {s.top && <span className="ps-st-yslot__top ps-num" style={{ bottom: `calc(${s.heightPct}% + 3px)` }} aria-hidden="true">{s.top}</span>}
                <span className="ps-st-ystack" style={{ height: `${s.heightPct}%` }}>
                  {s.segs.map((g) => <span key={g.key} className={g.cls} data-kind={g.kind} style={{ flexGrow: g.grow }} />)}
                </span>
              </span>
              <span className="ps-st-yslot__lbl" aria-hidden="true" data-cur={s.cur || undefined}>{s.label}</span>
              {s.sub && <span className="ps-st-yslot__sub" aria-hidden="true">{s.sub}</span>}
            </button>
          ))}
        </div>
      </div>
      <ChartTip target={active} panel={panel}>{activeSlot?.tip}</ChartTip>
    </div>
  );
}

function EmptyBlock({ icon, title, text }: { icon: 'bar-chart' | 'trophy'; title: string; text?: string }) {
  return (
    <div className="ps-st-empty">
      <Icon name={icon} size={40} />
      <b>{title}</b>
      {text && <span>{text}</span>}
    </div>
  );
}

/** «Часы по годам» (§12.3) с плашкой охвата снимками. */
export function HoursByYearPanel({ data, currentYear, wide }: { data: StatsResponse; currentYear: number; wide: boolean }) {
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const id = useId();
  const bars = useMemo(() => yearHoursBars(data.hours.byYear ?? []), [data.hours.byYear]);
  const has = hasYearHours(data);
  const hasEstimate = data.hours.hasEstimate || bars.some((b) => b.estimated > 0);
  const slots: Slot[] = bars.map((b) => ({
    year: b.year, label: b.label, empty: b.empty, heightPct: b.heightPct, cur: b.year === currentYear, text: b.text,
    segs: [
      ...(b.real > 0 ? [{ key: 'r', cls: 'ps-st-bar__fill', grow: b.realShare }] : []),
      ...(b.estimated > 0 ? [{ key: 'e', cls: 'ps-st-bar__est', grow: 100 - b.realShare }] : []),
    ],
    top: <>{b.mostlyEstimated && <span className="ps-st-yslot__approx">≈</span>}<span className="ps-st-yslot__val">{formatNumber(b.value)}</span></>,
    sub: b.allEstimated ? 'оценка' : undefined,
    tip: (
      <>
        <b>{b.label}</b>
        <span><b>{formatHours(b.value)} ч</b> всего</span>
        {b.real > 0 && <span><i className="ps-st-sw ps-st-sw--real" aria-hidden="true" />Измерено: {formatHours(b.real)} ч</span>}
        {b.estimated > 0 && <span><i className="ps-st-sw ps-st-sw--est" aria-hidden="true" />Оценка: {formatHours(b.estimated)} ч</span>}
      </>
    ),
  }));
  const note = coverageNote(data.hours.firstSnapshotDate, hasEstimate, data.hours.unattributed);
  const unattr = unattributedText(data.hours.unattributed);
  return (
    <Panel
      title="Часы по годам" sub="Сумма по годам равна общему итогу PSN" labelId={`st-hy-${id}`} className={wide ? 'ps-st-panel--hours-wide' : 'ps-st-panel--hours'} panelRef={setPanel}
      aside={has && hasEstimate ? (
        <ul className="ps-st-legend" aria-label="Обозначения">
          <li><i className="ps-st-sw ps-st-sw--real" aria-hidden="true" />Измерено</li>
          <li><i className="ps-st-sw ps-st-sw--est" aria-hidden="true" />Оценка</li>
        </ul>
      ) : undefined}
    >
      {has ? <YearChart id="hours-by-year" slots={slots} ariaLabel="Часы по годам" kind="hours" panel={panel} /> : <EmptyBlock icon="bar-chart" title="Часов пока нет" text="Часы появятся после синка" />}
      {has && note && <p className="ps-st-note ps-st-note--cover" role="note"><Icon name="info" size={14} /><span>{note}</span></p>}
      {has && unattr && <p className="ps-st-unattr ps-num" data-testid="unattributed">{unattr}</p>}
    </Panel>
  );
}

/** «Трофеи по годам» (§12.5). */
export function TrophiesByYearPanel({ data, currentYear }: { data: StatsResponse; currentYear: number }) {
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const id = useId();
  const c = data.trophies.counts;
  const bars = useMemo(() => yearTrophyBars(data.trophies.byYear ?? []), [data.trophies.byYear]);
  const has = c.total > 0 && bars.some((b) => !b.empty);
  const slots: Slot[] = bars.map((b) => ({
    year: b.year, label: b.label, empty: b.empty, heightPct: b.heightPct, cur: b.year === currentYear, text: b.text,
    segs: TROPHY_STACK.filter((k) => b.counts[k.kind] > 0).map((k) => ({ key: k.kind, cls: 'ps-st-tseg', grow: b.counts[k.kind], kind: k.kind })),
    top: b.counts.platinum > 0 ? <PlatinumIcon size={12} /> : undefined,
    tip: (
      <>
        <b>{b.label}</b>
        <span><b>{trophiesWord(b.counts.total)}</b></span>
        {[...TROPHY_STACK].reverse().filter((k) => b.counts[k.kind] > 0).map((k) => (
          <span key={k.kind}><i className="ps-st-sw ps-st-sw--t" data-kind={k.kind} aria-hidden="true" />{k.label} {b.counts[k.kind]}</span>
        ))}
      </>
    ),
  }));
  const kinds = [
    { id: 'platinum', label: 'Платина' }, { id: 'gold', label: 'Золото' }, { id: 'silver', label: 'Серебро' }, { id: 'bronze', label: 'Бронза' },
  ] as const;
  return (
    <Panel
      title="Трофеи по годам" sub="по дате получения" labelId={`st-ty-${id}`} className="ps-st-panel--wide" panelRef={setPanel}
      aside={has ? (
        <ul className="ps-st-legend" aria-label="Обозначения">
          {kinds.map((k) => <li key={k.id}><i className="ps-st-sw ps-st-sw--t" data-kind={k.id} aria-hidden="true" />{k.label}</li>)}
        </ul>
      ) : undefined}
    >
      <ul className="ps-st-troph">
        {kinds.map((k) => (
          <li key={k.id} data-kind={k.id} aria-label={`${k.label}: ${formatNumber(c[k.id])}`}>
            {k.id === 'platinum' ? <PlatinumIcon size={22} /> : <Icon name="trophy" size={22} />}
            <span className="ps-st-troph__v ps-num">{formatNumber(c[k.id])}</span>
            <span className="ps-st-troph__l">{k.label}</span>
          </li>
        ))}
      </ul>
      {has ? <YearChart id="trophies-by-year" slots={slots} ariaLabel="Трофеи по годам" kind="trophies" panel={panel} /> : <EmptyBlock icon="trophy" title="Трофеев пока нет" />}
      <FeedLink />
    </Panel>
  );
}

/** «Пройдено и брошено по годам» (§12.4): клик по строке открывает год. */
export function FinishedByYearPanel({ data, onOpenYear }: { data: StatsResponse; onOpenYear: (year: number) => void }) {
  const id = useId();
  const rows = useMemo(() => finishedYearRows(data.finished.byYear ?? []), [data.finished.byYear]);
  const h = data.header;
  return (
    <Panel title="Пройдено и брошено" sub="Нажми на год, чтобы открыть его" labelId={`st-fy-${id}`} className="ps-st-panel--wide">
      {rows.length === 0 ? (
        <p className="ps-st-fy__none">Пройденных и брошенных игр пока нет</p>
      ) : (
        <>
          <ol className="ps-st-fy">
            {rows.map((r) => (
              <li key={r.year}>
                <button type="button" className="ps-st-fy__row" aria-label={r.text} onClick={() => onOpenYear(r.year)}>
                  <span className="ps-st-fy__y num">{r.year}</span>
                  <span className="ps-st-fy__bars" aria-hidden="true">
                    <span className="ps-st-fy__bar"><i data-kind="completed" style={{ width: `${r.completedPct}%` }} /></span>
                    <span className="ps-st-fy__bar"><i data-kind="dropped" style={{ width: `${r.droppedPct}%` }} /></span>
                  </span>
                  <span className="ps-st-fy__n num" aria-hidden="true">
                    <span data-zero={r.completed === 0 || undefined}><StatusGlyph status="completed" size={14} />{r.completed}</span>
                    <span data-zero={r.dropped === 0 || undefined}><StatusGlyph status="dropped" size={14} />{r.dropped}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="ps-st-fy__total" data-testid="finished-total">
            <b>Всего</b>
            <span className="ps-st-fy__n num">
              <span><StatusGlyph status="completed" size={14} />{h.completed}</span>
              <span><StatusGlyph status="dropped" size={14} />{h.dropped}</span>
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}
