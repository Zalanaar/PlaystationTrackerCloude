'use client';

import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { PlayPattern } from '@/server/stats/types';
import { Icon } from '../icons';
import { useIsMobile } from '../primitives/hooks';
import { ChartTip, useChartTip, useInViewOnce } from './chartTip';
import { Panel } from './Panel';
import {
  hourBars, hourLabel, hourRange, patternReady, PATTERN_CAPTION, rovingNext, trophiesCount, WEEKDAY_NOM, WEEKDAY_SHORT, weekdayBars, type PatternBar,
} from './playPattern';

const STUB_HEIGHTS = [28, 22, 20, 24, 30, 36, 44, 52, 58, 50, 46, 54, 60, 52, 48, 56, 60, 58, 52, 44, 36, 30, 26, 22];

/** Группа столбцов с roving tabindex: один Tab-стоп, стрелки, Home/End. */
function BarGroup({
  bars, ariaLabel, kind, labelEvery, tipTitle, panel, animId, stepMs,
}: {
  bars: PatternBar[]; ariaLabel: string; kind: 'hours' | 'weekdays'; labelEvery: number; tipTitle: (b: PatternBar) => string;
  panel: HTMLElement | null; animId: string; stepMs: number;
}) {
  const { active, attachGroup, groupProps, itemProps, close } = useChartTip();
  const { attach: attachView, seen, instant } = useInViewOnce(animId);
  const [cur, setCur] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const move = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    if (e.key === 'Escape') { close(); return; }
    const next = rovingNext(e.key, i, bars.length);
    if (next === null) return;
    e.preventDefault();
    setCur(next);
    refs.current[next]?.focus();
  };
  const activeBar = active ? bars[Number(active.key)] : undefined;
  const peakFirst = bars.find((b) => b.peak)?.index;
  return (
    <div className="ps-pp__chart" data-kind={kind} data-in={seen ? (instant ? 'done' : 'go') : undefined} ref={attachView}>
      <div className="ps-pp__bars" role="group" aria-label={ariaLabel} ref={attachGroup} {...groupProps}>
        {bars.map((b, i) => {
          const ip = itemProps(i);
          return (
            <div key={b.index} className="ps-pp__slot" data-every={i % labelEvery === 0 || undefined}>
              <div
                ref={(el) => { refs.current[i] = el; }} role="img" aria-label={b.text} tabIndex={i === cur ? 0 : -1}
                className="ps-pp__col" data-peak={b.peak || undefined} data-zero={b.value === 0 || undefined} data-active={active?.key === i || undefined}
                style={{ '--h': `${b.heightPct}%`, '--i': i, '--step': `${stepMs}ms` } as CSSProperties}
                {...ip}
                onFocus={(e) => { setCur(i); ip.onFocus(e); }}
                onKeyDown={(e) => { ip.onKeyDown(e); move(e, i); }}
              >
                {b.value > 0 && <span className="ps-pp__fill" />}
                {kind === 'hours' && peakFirst === i && <span className="ps-pp__pill" aria-hidden="true">{hourLabel(b.index)}</span>}
                {kind === 'weekdays' && b.peak && <span className="ps-pp__val ps-num" aria-hidden="true">{b.value}</span>}
              </div>
              <span className="ps-pp__lbl" aria-hidden="true" data-peak={b.peak || undefined}>{b.label.length === 5 && kind === 'hours' ? b.label.slice(0, 2) : b.label}</span>
            </div>
          );
        })}
      </div>
      <ChartTip target={active} panel={panel}>
        {activeBar && (
          <>
            <b>{tipTitle(activeBar)}</b>
            <span><b>{trophiesCount(activeBar.value)}</b></span>
            <small>{activeBar.pct}%</small>
          </>
        )}
      </ChartTip>
    </div>
  );
}

/** «Когда ты играешь» (§12.6): трофеи по часам суток и дням недели по часам устройства (Пакет 6, п. 3). Во всех периодах. */
export function PlayPatternPanel({ pattern, periodKey }: { pattern: PlayPattern | undefined; periodKey: string }) {
  const id = useId();
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const mobile = useIsMobile();
  const ready = patternReady(pattern);
  const hours = useMemo(() => (ready ? hourBars(pattern) : []), [ready, pattern]);
  const days = useMemo(() => (ready ? weekdayBars(pattern) : []), [ready, pattern]);
  if (!pattern) return null;
  return (
    <Panel title="Когда ты играешь" sub={PATTERN_CAPTION} labelId={`st-pp-${id}`} className="ps-st-panel--wide ps-pp" panelRef={setPanel}>
      {ready ? (
        <>
          <p className="ps-pp__sum" data-testid="pp-summary">
            Чаще всего: <b>{hourRange(pattern.peakHour ?? 0)}</b>, <b>{(WEEKDAY_NOM[pattern.peakWeekday ?? 0] ?? '').toLowerCase()}</b>
          </p>
          <div className="ps-pp__grid">
            <div className="ps-pp__hours">
              <BarGroup
                key={`h-${periodKey}`} bars={hours} ariaLabel="Трофеи по часам суток" kind="hours" labelEvery={mobile ? 6 : 3} tipTitle={(b) => hourRange(b.index)}
                panel={panel} animId={`pp-hours-${periodKey}`} stepMs={20}
              />
            </div>
            <div className="ps-pp__days">
              <BarGroup
                key={`d-${periodKey}`} bars={days} ariaLabel="Трофеи по дням недели" kind="weekdays" labelEvery={1} tipTitle={(b) => WEEKDAY_NOM[b.index] ?? WEEKDAY_SHORT[b.index] ?? ''}
                panel={panel} animId={`pp-days-${periodKey}`} stepMs={20}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="ps-pp__stub" data-testid="pp-stub">
          <div className="ps-pp__stubbars" aria-hidden="true">
            {STUB_HEIGHTS.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
          </div>
          <div className="ps-pp__stubmsg">
            <Icon name="clock" size={24} />
            <b>Пока мало данных</b>
            <span>Нужно больше трофеев с датой в выбранном периоде.</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
