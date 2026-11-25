'use client';

import { useEffect, useId, useState } from 'react';
import type { AchievementsResponse } from '@/server/achievements/achievements';
import { fetchAchievements } from '../collection/api';
import { Icon } from '../icons';
import { Panel } from './Panel';
import { ACH_META, achPercent, achState, achSummary } from './achievements';

const SLOTS = 12;

/**
 * П13.1: «Достижения» в «Всё время». Сетка постоянная (12 плиток одной высоты) у скелета и данных — без сдвига.
 * Сбой запроса — панели нет (страница не ломается).
 * t281u П.23: в группе «Трофеи» — одна строка «Достижения · Получено N из 12», сетка раскрывается по «Показать».
 */
export function AchievementsPanel() {
  const id = useId();
  const [data, setData] = useState<AchievementsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const ac = new AbortController();
    fetchAchievements(ac.signal).then((r) => { if (!ac.signal.aborted) setData(r); }, () => { if (!ac.signal.aborted) setFailed(true); });
    return () => ac.abort();
  }, []);
  if (failed) return null;
  return (
    <Panel
      title="Достижения" labelId={`st-ach-${id}`} className="ps-ach" busy={!data}
      sub={data ? `Получено ${achSummary(data.unlocked, data.total)}` : 'Загрузка…'}
      aside={(
        <button
          type="button" className="ps-link ps-ach__toggle" data-testid="ach-toggle" aria-expanded={open} aria-controls={`st-ach-g-${id}`}
          disabled={!data} onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Свернуть' : 'Показать'}
        </button>
      )}
    >
      {open && (
      <ul className="ps-ach__grid" id={`st-ach-g-${id}`} data-testid="ach-grid">
        {data
          ? data.items.map((a) => {
            const m = ACH_META[a.id];
            const pct = achPercent(a);
            return (
              <li key={a.id} className="ps-ach__item" data-unlocked={a.unlocked || undefined} data-testid="ach-item" data-ach={a.id}>
                <span className="ps-ach__ic" aria-hidden="true"><Icon name={a.unlocked ? m.icon : 'lock'} size={18} /></span>
                <span className="ps-ach__text">
                  <b className="ps-ach__t">{m.title}</b>
                  <span className="ps-ach__d">{m.text}</span>
                  <span className="ps-ach__s num">{achState(a)}</span>
                  {!a.unlocked && (
                    <span className="ps-ach__bar" role="progressbar" aria-label={`${m.title}: прогресс`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                      <i style={{ width: `${pct}%` }} />
                    </span>
                  )}
                </span>
              </li>
            );
          })
          : Array.from({ length: SLOTS }, (_, i) => <li key={i} className="ps-ach__item ps-skeleton" aria-hidden="true" />)}
      </ul>
      )}
    </Panel>
  );
}
