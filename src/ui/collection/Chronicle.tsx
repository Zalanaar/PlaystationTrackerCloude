'use client';

import type { ReactNode } from 'react';
import { formatNumber, monthName, plural } from '../format';
import { Icon, StatusGlyph } from '../icons';
import type { ChronicleMonth } from './chronicle';

/** Заголовок блока (`.ps-block__head`): h2 + счётчик + действие справа. */
export function BlockHead({ id, title, count, icon, children }: { id?: string; title: string; count?: number; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ps-block__head">
      {icon}
      <h2 className="ps-h2" id={id}>{title}</h2>
      {count !== undefined && <span className="ps-block__cnt ps-num">{formatNumber(count)}</span>}
      {children && <span className="ps-block__act">{children}</span>}
    </div>
  );
}

/**
 * Заголовок года (§4.8); целиком кнопка сворачивания. `label` вместо года для «Без даты» / «Не запускались».
 * Хроника: факты «пройдено/брошено» из `completed`/`dropped`; другие режимы передают свои `facts`.
 */
export function YearHeader({
  id, label, completed = 0, dropped = 0, facts, hours, expanded, onToggle, hint, sectionId,
}: {
  id: string; label: string; completed?: number; dropped?: number; facts?: ReactNode; hours: number | null;
  expanded: boolean; onToggle: () => void; hint?: string; sectionId: string;
}) {
  return (
    <h2 className="ps-year" id={id}>
      <button type="button" className="ps-year__btn" data-plain={hours === null || undefined} data-expanded={expanded} aria-expanded={expanded} aria-controls={sectionId} onClick={onToggle}>
        <span className="ps-year__y">{label}</span>
        {facts ?? (
          <>
            <span className="ps-year__k"><StatusGlyph status="completed" size={16} />пройдено <b className="num">{completed}</b></span>
            <span className="ps-year__k"><StatusGlyph status="dropped" size={16} />брошено <b className="num">{dropped}</b></span>
          </>
        )}
        {hours !== null && hours > 0 && <span className="ps-year__k"><b className="num">{formatNumber(hours)} ч</b><span className="ps-year__more"> в этих играх</span></span>}
        {hint && expanded && <span className="ps-year__hint">{hint}</span>}
        {!expanded && <span className="ps-year__exp">Развернуть <Icon name="chevron-down" size={12} /></span>}
      </button>
    </h2>
  );
}

/** Факт «N игр» для заголовка года вне хроники. */
export function GamesFact({ n }: { n: number }) {
  return <span className="ps-year__k"><b className="num">{formatNumber(n)}</b> {plural(n, ['игра', 'игры', 'игр'])}</span>;
}

export function MonthHeader({ m }: { m: Pick<ChronicleMonth, 'month' | 'completed' | 'dropped'> }) {
  return (
    <h3 className="ps-month">
      {monthName(m.month)}
      <small className="num">
        {m.completed > 0 && <span title={`пройдено ${m.completed}`}><StatusGlyph status="completed" size={12} />{m.completed}</span>}
        {m.dropped > 0 && <span title={`брошено ${m.dropped}`}><StatusGlyph status="dropped" size={12} />{m.dropped}</span>}
      </small>
    </h3>
  );
}
