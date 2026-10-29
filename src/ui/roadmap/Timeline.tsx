'use client';

import { Fragment, useMemo, useRef, useState } from 'react';
import type { RoadmapResponse } from '@/server/roadmap/types';
import { Icon } from '../icons';
import { plural } from '../format';
import { useIsMobile } from '../primitives/hooks';
import {
  barLabel, conflictNumbers, conflictText, dayNumber, dayText, hoursLabel, layoutBars, MONTHS_AXIS, MONTHS_NOM, monthStartWeeks, parseYmd,
  rangeText, weekPos, weeksText, type Bar, type ExtraGames,
} from './model';
import { jumpToEntry, Spinner, Thumb } from './parts';

type Tip = { bar: Bar; left: number; top: number };

function Gantt({ data, onJump }: { data: RoadmapResponse; onJump: (key: string) => void }) {
  const { weeks, items, conflicts, settings, today } = data;
  const n = weeks.length;
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { bars, rows } = useMemo(() => layoutBars(items, weeks), [items, weeks]);
  const nums = useMemo(() => conflictNumbers(conflicts), [conflicts]);
  const starts = useMemo(() => monthStartWeeks(weeks, settings.year), [weeks, settings.year]);
  const todayInYear = today >= data.range.from && today <= data.range.to;
  const tw = todayInYear ? weekPos(weeks, today) : -1; // 0-based
  const off = tw >= 0 ? 1 : 0; // строка ярлыка «Сегодня»
  const axisRow = 1 + off;
  const relRows = Math.max(1, rows.release);
  const queRows = Math.max(1, rows.queue);
  const relStart = axisRow + 1;
  const queStart = relStart + relRows;
  const lastRow = queStart + queRows - 1;
  const rowOf = (b: Bar) => (b.lane === 'release' ? relStart : queStart) + b.row;
  const curMonth = todayInYear ? (parseYmd(today)?.m ?? 0) - 1 : -1;

  function show(bar: Bar, el: HTMLElement, delay: boolean) {
    const open = () => {
      const r = el.getBoundingClientRect();
      setTip({ bar, left: Math.max(8, Math.min(r.left, window.innerWidth - 296)), top: r.bottom + 6 });
    };
    if (timer.current) clearTimeout(timer.current);
    if (delay) timer.current = setTimeout(open, 150);
    else open();
  }
  function hide() {
    if (timer.current) clearTimeout(timer.current);
    setTip(null);
  }

  const lane = (label: string, from: number, count: number, empty: string, has: boolean) => (
    <>
      <div className="ps-rm-g__lbl" style={{ gridColumn: 1, gridRow: `${from} / span ${count}` }}>{label}</div>
      <div className="ps-rm-g__lane" aria-hidden="true" style={{ gridColumn: `2 / -1`, gridRow: `${from} / span ${count}` }} />
      {!has && <p className="ps-rm-g__empty" style={{ gridColumn: '2 / -1', gridRow: from }}>{empty}</p>}
    </>
  );

  return (
    <div className="ps-rm-g__scroll" onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}>
      <div
        className="ps-rm-g" role="group" aria-label={`Таймлайн плана на ${settings.year} год`}
        style={{ '--n': n, gridTemplateColumns: `var(--rm-label-w) repeat(${n}, minmax(12px, 1fr))`, gridTemplateRows: `${off ? '20px ' : ''}var(--rm-axis-h) repeat(${relRows + queRows}, var(--rm-bar-h))` } as React.CSSProperties}
      >
        {tw >= 0 && (
          <div className="ps-rm-g__todayrow" aria-hidden="true" style={{ gridColumn: '2 / -1', gridRow: 1 }}>
            <span style={{ left: `${((tw + 0.5) / n) * 100}%`, transform: `translateX(-${((tw + 0.5) / n) * 100}%)` }}>Сегодня, {dayText(today)}</span>
          </div>
        )}
        {lane('Релизы', relStart, relRows, 'Релизов в плане нет', rows.release > 0)}
        {lane('Очередь', queStart, queRows, 'Очередь пуста', rows.queue > 0)}
        {/* текущая неделя */}
        {tw >= 0 && <div className="ps-rm-g__now" aria-hidden="true" style={{ gridColumn: tw + 2, gridRow: `${axisRow + 1} / ${lastRow + 1}` }} />}
        {/* месяцы: подписи оси и разделители */}
        {starts.map((s, m) => {
          const next = m < 11 ? starts[m + 1] : n;
          return (
            <Fragment key={m}>
              <div className="ps-rm-g__month" aria-hidden="true" data-cur={m === curMonth || undefined} style={{ gridColumn: `${s + 2} / ${next + 2}`, gridRow: axisRow }}>{MONTHS_AXIS[m]}</div>
              {m > 0 && <div className="ps-rm-g__sep" aria-hidden="true" style={{ gridColumn: s + 2, gridRow: `${axisRow + 1} / ${lastRow + 1}` }} />}
            </Fragment>
          );
        })}
        {/* конфликты: штриховка + ярлык */}
        {conflicts.map((c, i) => {
          if (c.to < data.range.from || c.from > data.range.to) return null; // промежуток вне года плана: только текст в списке
          const s = weekPos(weeks, c.from) + 1;
          const e = Math.max(s, weekPos(weeks, c.to) + 1);
          return (
            <div key={i} className="ps-rm-g__conf" style={{ gridColumn: `${s + 1} / ${e + 2}`, gridRow: `${axisRow + 1} / ${lastRow + 1}` }}>
              <a className="ps-rm-g__clabel" href={`#rm-conflict-${i + 1}`}>
                <Icon name="alert" size={14} />Конфликт {i + 1} · {rangeText(c.from, c.to)}
              </a>
            </div>
          );
        })}
        {bars.map((b) => {
          const cn = nums.get(b.key) ?? [];
          const w = b.endWeek - b.startWeek + 1;
          const wide = w >= 8;
          return (
            <button
              key={`${b.key}-${b.segIndex}`} type="button" className="ps-rm-bar" data-kind={b.lane} data-conflict={cn.length ? 'true' : undefined}
              data-testid="rm-bar" data-key={b.key}
              style={{ gridColumn: `${b.startWeek + 1} / ${b.endWeek + 2}`, gridRow: rowOf(b) }}
              aria-label={barLabel(b, cn)}
              onClick={() => onJump(b.key)}
              onMouseEnter={(e) => show(b, e.currentTarget, true)} onMouseLeave={hide}
              onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) show(b, e.currentTarget, false); }} onBlur={hide}
            >
              <span className="ps-rm-bar__in">
                {cn.length > 0 ? <Icon name="alert" size={14} /> : b.lane === 'release' && wide ? <Icon name="calendar" size={14} /> : null}
                <span className="ps-rm-bar__t">{b.segIndex === 0 ? b.item.title : `… ${b.segIndex + 1}/${b.segCount}`}</span>
              </span>
            </button>
          );
        })}
      </div>
      {tip && <GanttTip tip={tip} nums={nums.get(tip.bar.key) ?? []} data={data} />}
    </div>
  );
}

function GanttTip({ tip, nums, data }: { tip: Tip; nums: number[]; data: RoadmapResponse }) {
  const it = tip.bar.item;
  const c = nums[0] ? data.conflicts[nums[0] - 1] : null;
  return (
    <div className="ps-rm-tip" role="presentation" aria-hidden="true" style={{ left: tip.left, top: tip.top }}>
      <b>{it.title}</b>
      <span>{rangeText(it.start, it.end)} · {weeksText(it.days)}{` · ${hoursLabel(tip.bar.seg.hours)}`}</span>
      <span>
        {it.kind === 'release' ? `Выходит ${it.releaseDate ? dayText(it.releaseDate) : 'без даты'} · с даты выхода` : `Позиция ${it.queuePosition ?? '—'} в очереди`}
      </span>
      {c && nums[0] && <span className="ps-rm-tip__c"><Icon name="alert" size={12} />Конфликт {nums[0]}: {c.reason === 'release_overlap' ? 'пересечение релизов' : c.reason === 'exceeds_year_end' ? 'релиз не помещается в год' : 'релиз вышел до начала года'}</span>}
    </div>
  );
}

function MonthsView({ data, onJump, extra }: { data: RoadmapResponse; onJump: (key: string) => void; extra?: ExtraGames }) {
  const { months, items, conflicts, settings, today } = data;
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const nowYear = parseYmd(today)?.y;
  const cur = nowYear === settings.year ? (parseYmd(today)?.m ?? 1) - 1 : -1;
  const [open, setOpen] = useState(false);
  const collapsed = cur > 0 && !open;
  const first = collapsed ? cur : 0;
  const nums = useMemo(() => conflictNumbers(conflicts), [conflicts]);

  return (
    <div className="ps-rm-mo__wrap">
      {cur > 0 && (
        <button type="button" className="ps-rm-mo__past" aria-expanded={!collapsed} onClick={() => setOpen((v) => !v)}>
          <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={14} />
          {collapsed ? `Прошедшие месяцы: ${MONTHS_AXIS[0].toLowerCase()} – ${MONTHS_AXIS[cur - 1].toLowerCase()}` : 'Скрыть прошедшие месяцы'}
        </button>
      )}
      <ol className="ps-rm-mo" aria-label={`Таймлайн плана по месяцам, ${settings.year}`}>
        {months.slice(first).map((m, k) => {
          const idx = first + k;
          const list = m.items.map((li) => {
            const it = byKey.get(li.key);
            if (!it) return null;
            const segs = it.segments.filter((s) => s.to >= m.from && s.from <= m.to);
            if (!segs.length) return null;
            const a = segs.reduce((x, s) => (s.from < x ? s.from : x), segs[0].from);
            const z = segs.reduce((x, s) => (s.to > x ? s.to : x), segs[0].to);
            const start = a < m.from ? m.from : a;
            const end = z > m.to ? m.to : z;
            const before = a < m.from;
            const after = z > m.to;
            const when = before && after ? 'весь месяц' : before ? `до ${dayText(end)}` : after ? `с ${dayText(start)}` : rangeText(start, end);
            const left = ((dayNumber(start) - dayNumber(m.from)) / m.days) * 100;
            const width = ((dayNumber(end) - dayNumber(start) + 1) / m.days) * 100;
            return { it, hours: li.hours, when, left, width };
          }).filter((x): x is NonNullable<typeof x> => x !== null);
          const mConf = conflicts.map((c, i) => ({ c, n: i + 1 })).filter(({ c }) => c.to >= m.from && c.from <= m.to);
          return (
            <li key={m.month} className="ps-rm-mo__m" data-cur={idx === cur || undefined} data-testid="rm-month">
              <div className="ps-rm-mo__head">
                <h3>{MONTHS_NOM[idx]}</h3>
                {idx === cur && <span className="ps-rm-tag ps-rm-tag--now">Сейчас</span>}
                <small>{list.length ? `${list.length} ${plural(list.length, ['игра', 'игры', 'игр'])}` : 'Свободно'}</small>
              </div>
              {mConf.map(({ c, n }) => {
                const t = conflictText(c, n, data, extra);
                return (
                  <div key={n} className="ps-rm-conf" role="note">
                    <Icon name="alert" size={16} />
                    <div>
                      <p><b>Конфликт {n}: {rangeText(c.from, c.to)}</b></p>
                      <p>{t.body.split('. ')[0].replace(/\.$/, '')}. <a href={`#rm-conflict-${n}`}>Подробнее</a></p>
                    </div>
                  </div>
                );
              })}
              {list.map(({ it, hours, when, left, width }) => (
                <button key={it.key} type="button" className="ps-rm-mo__g" onClick={() => onJump(it.key)} aria-label={`${it.title}: ${it.kind === 'release' ? 'релиз' : 'очередь'}, ${when}, ${hoursLabel(hours)}${nums.get(it.key) ? `, конфликт ${nums.get(it.key)?.join(', ')}` : ''}`}>
                  <Thumb url={it.coverUrl} title={it.title} w={28} h={37} />
                  <span className="ps-rm-mo__tx">
                    <b>{it.title}</b>
                    <small>
                      {it.kind === 'release' && <span className="ps-rm-tag"><Icon name="calendar" size={12} />Релиз</span>}
                      {when}
                    </small>
                  </span>
                  <span className="num ps-rm-mo__h">{hoursLabel(hours)}</span>
                  <span className="ps-rm-mo__bar" aria-hidden="true"><i data-kind={it.kind === 'release' ? 'release' : 'queue'} style={{ left: `${left}%`, width: `${Math.max(width, 2)}%` }} /></span>
                </button>
              ))}
              {!list.length && !mConf.length && <p className="ps-rm-muted">Свободно</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Блок «Конфликты плана» под сеткой (id rm-conflict-N, фокусируемые). */
export function ConflictList({ data, onJump, extra }: { data: RoadmapResponse; onJump: (key: string) => void; extra?: ExtraGames }) {
  const { conflicts } = data;
  if (!conflicts.length) return null;
  const entries = new Map([...data.needHours, ...data.notFit, ...data.items].map((e) => [e.key, e]));
  return (
    <section id="rm-conflicts" className="ps-rm-confs" aria-labelledby="rm-conflicts-h">
      <h3 id="rm-conflicts-h" className="ps-rm-h3"><Icon name="alert" size={16} />Конфликты плана <small className="num">{conflicts.length}</small></h3>
      <ul>
        {conflicts.map((c, i) => {
          const t = conflictText(c, i + 1, data, extra);
          return (
            <li key={i} id={`rm-conflict-${i + 1}`} tabIndex={-1} className="ps-rm-conf" data-testid="rm-conflict" data-reason={c.reason}>
              <Icon name="alert" size={16} />
              <div>
                <p><b>{t.title}</b></p>
                <p>{t.body}</p>
                <p className="ps-rm-conf__games">
                  {c.keys.map((k) => entries.get(k) && (
                    <button key={k} type="button" className="ps-link ps-rm-conf__link" onClick={() => onJump(k)}>{entries.get(k)?.title}</button>
                  ))}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Панель таймлайна: Gantt по неделям (десктоп) или список месяцев (мобильный, по переключателю). */
export function TimelinePanel({ data, recalculating, onJump, extra }: { data: RoadmapResponse; recalculating: boolean; onJump?: (key: string) => void; extra?: ExtraGames }) {
  const mobile = useIsMobile();
  const [mode, setMode] = useState<'bars' | 'months'>('bars');
  const jump = onJump ?? jumpToEntry;
  const view = mobile ? 'months' : mode;
  const empty = data.items.length === 0;
  const nConf = data.conflicts.length;
  const nOver = data.notFit.length;
  return (
    <div aria-busy={recalculating || undefined} className="ps-rm-tl">
      <div className="ps-rm-head">
        <h2 className="ps-h2">Таймлайн {data.settings.year}</h2>
        {!mobile && !empty && (
          <div className="ps-seg" role="group" aria-label="Вид таймлайна">
            <button type="button" aria-pressed={mode === 'bars'} onClick={() => setMode('bars')}>Полосы</button>
            <button type="button" aria-pressed={mode === 'months'} onClick={() => setMode('months')}>По месяцам</button>
          </div>
        )}
      </div>
      {(nConf > 0 || nOver > 0) && (
        <div className="ps-rm-chips">
          {nConf > 0 && <a className="ps-rm-chip" href="#rm-conflicts"><Icon name="alert" size={12} />Конфликтов: {nConf}</a>}
          {nOver > 0 && <a className="ps-rm-chip" href="#rm-over"><Icon name="clock" size={12} />Не успеваю: {nOver}</a>}
        </div>
      )}
      {recalculating && <span className="ps-rm-recalc" role="status"><Spinner />Пересчёт…</span>}
      {empty ? (
        <div className="ps-rm-empty">
          <Icon name="roadmap" size={40} />
          <h3 className="ps-h3">На таймлайне пока пусто</h3>
          <p>Укажи часы играм из бэклога или добавь релиз с галкой «Хочу пройти на релизе».</p>
        </div>
      ) : view === 'bars' ? <Gantt data={data} onJump={jump} /> : <MonthsView data={data} onJump={jump} extra={extra} />}
      <ConflictList data={data} onJump={jump} extra={extra} />
    </div>
  );
}

