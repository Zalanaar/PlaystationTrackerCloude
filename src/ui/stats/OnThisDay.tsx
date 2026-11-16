'use client';

import type { OnThisDayResponse } from '@/server/stats/day';
import { Icon } from '../icons';
import { daySummary, onThisDayLine, yearsAgo } from './day';

/**
 * П11.2 «В этот день»: сегодняшний день в прошлые годы (данные грузятся вместе с «Активностью»). Нет таких дней — блока нет.
 * Тап по году открывает «Дневник дня» на эту дату.
 */
export function OnThisDay({ data, selected, onPick }: { data: OnThisDayResponse; selected: string | null; onPick: (date: string) => void }) {
  if (data.items.length === 0) return null;
  return (
    <section className="ps-otd" aria-labelledby="st-otd" data-testid="on-this-day">
      <h4 className="ps-otd__t" id="st-otd"><Icon name="calendar" size={14} />В этот день</h4>
      <ul className="ps-otd__list">
        {data.items.map((d) => {
          const line = onThisDayLine(d);
          return (
            <li key={d.date}>
              <button type="button" className="ps-otd__row" aria-pressed={selected === d.date} onClick={() => onPick(d.date)} data-testid="otd-row">
                <span className="ps-otd__y num">{d.date.slice(0, 4)}</span>
                <span className="ps-otd__tx">
                  <span className="ps-otd__ago">{yearsAgo(d.date, data.today)} · {daySummary(d)}</span>
                  {line && <span className="ps-otd__line">{line}</span>}
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
