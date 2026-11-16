'use client';

import { useId } from 'react';
import type { DlcProgress as DlcProgressData } from '../trophies';
import { DLC_STATE_LABEL } from '../trophies';
import { Icon } from '../../icons';

/**
 * Пакет 7, п. 1: «Прогресс по дополнениям» в «Обзоре» окна игры — основная игра и каждое DLC (названия групп PSN),
 * незакрытые дополнения подсвечены как мини-бэклог. Строка — кнопка: открывает «Трофеи» на этом разделе.
 */
export function DlcProgress({ data, onOpen }: { data: DlcProgressData; onOpen?: (key: string) => void }) {
  const hId = useId();
  return (
    <section className="ps-gd__sec ps-gd__dlcp" aria-labelledby={hId} data-testid="dlc-progress" data-open={data.dlcOpen > 0 || undefined}>
      <div className="ps-gd__dlcph">
        <h3 id={hId}>Прогресс по дополнениям</h3>
        <span className="ps-gd__dlcps" data-testid="dlc-progress-summary">{data.summary}</span>
      </div>
      <ul className="ps-gd__dlcpl">
        {data.rows.map((r) => {
          const inner = (
            <>
              <span className="ps-gd__dlcpt">
                <span className="ps-gd__dlcpn">{r.title}</span>
                {r.dlc && r.state !== 'done' && <span className="ps-gd__dlcptag" data-state={r.state}>{DLC_STATE_LABEL[r.state]}</span>}
                <span className="ps-gd__dlcpc num">{r.earned}/{r.total}</span>
              </span>
              <span className="ps-gd__dlcpbar" aria-hidden="true"><i style={{ width: `${r.pct}%` }} /></span>
            </>
          );
          const aria = `${r.title}: получено ${r.earned} из ${r.total}, ${r.pct}%${r.dlc ? `, ${DLC_STATE_LABEL[r.state].toLowerCase()}` : ''}`;
          return (
            <li key={r.key} data-dlc={r.dlc || undefined} data-state={r.state} data-testid="dlc-progress-row">
              {onOpen ? (
                <button type="button" className="ps-gd__dlcpr" aria-label={`${aria}. Открыть трофеи`} onClick={() => onOpen(r.key)}>
                  {inner}
                  <Icon name="chevron-right" size={16} className="ps-gd__dlcpgo" />
                </button>
              ) : (
                <div className="ps-gd__dlcpr" aria-label={aria}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
