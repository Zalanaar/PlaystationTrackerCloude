import type { ReactNode } from 'react';
import type { GameItem } from '@/server/collection/types';
import { GamesFact, YearHeader } from '../Chronicle';
import { MonthChips } from '../MonthChips';
import { anchorsByGame, flatYearGames, yearMonthChips } from '../monthChips';
import { moreBtn, renderGames } from './renderGames';
import type { RenderCtx } from './renderCtx';

export function renderChronicle(c: RenderCtx): ReactNode {
  const { filters, counts, chron, isOpen, toggle, rawLoaded } = c;
  const loaded = rawLoaded('chronicle');
  const totalChron = filters.status === 'completed' ? counts.completed : filters.status === 'dropped' ? counts.dropped : counts.completed + counts.dropped;
  return (
    <>
      {chron.years.map((y) => {
        const open = isOpen(y.year);
        return (
          <section key={y.year} className="ps-chron" id={`y${y.year}`} aria-labelledby={`h${y.year}`}>
            <YearHeader
              id={`h${y.year}`} label={String(y.year)} completed={y.completed} dropped={y.dropped} hours={Math.round(y.seconds / 3600)}
              expanded={open} onToggle={() => toggle(y.year)} hint="дата завершения, МСК" sectionId={`y${y.year}-body`}
            />
            {open && yearMonthChips(y).length > 0 && <MonthChips key={y.year} year={y.year} chips={yearMonthChips(y)} />}
            <div id={`y${y.year}-body`} className="ps-chron__body" hidden={!open}>
              {open && renderGames(c, flatYearGames(y), { anchors: anchorsByGame(y) })}
            </div>
          </section>
        );
      })}
      {chron.undated.length > 0 && (
        <section className="ps-chron" id="undated" aria-labelledby="h-undated">
          <YearHeader
            id="h-undated" label="Без даты" completed={chron.undatedCompleted} dropped={chron.undatedDropped} hours={null}
            expanded={isOpen('undated')} onToggle={() => toggle('undated')} sectionId="undated-body"
          />
          <div id="undated-body" hidden={!isOpen('undated')}>
            {isOpen('undated') && <div className="ps-chron__month">{renderGames(c, chron.undated)}</div>}
          </div>
        </section>
      )}
      {moreBtn(c, 'chronicle', totalChron - loaded)}
    </>
  );
}

/** «По последней игре»: группы по году последнего запуска, затем «Не запускались». Подгрузка дописывает игры в последнюю группу. */
export function renderPlayed(c: RenderCtx): ReactNode {
  const { played, isPlayedOpen, togglePlayed } = c;
  const group = (key: string, label: string, games: GameItem[], hours: number | null) => {
    const open = isPlayedOpen(key);
    const sid = key === 'never' ? 'never' : `y${key}`;
    return (
      <section key={key} className="ps-chron" id={sid} aria-labelledby={`h-${sid}`}>
        <YearHeader
          id={`h-${sid}`} label={label} facts={<GamesFact n={games.length} />} hours={hours}
          expanded={open} onToggle={() => togglePlayed(key)} hint={key === 'never' ? undefined : 'последний запуск, МСК'} sectionId={`${sid}-body`}
        />
        <div id={`${sid}-body`} className="ps-chron__flat" hidden={!open}>
          {open && renderGames(c, games, { dateYear: true, withHeader: true })}
        </div>
      </section>
    );
  };
  return (
    <>
      {played.years.map((y) => group(String(y.year), String(y.year), y.games, Math.round(y.seconds / 3600)))}
      {played.never.length > 0 && group('never', 'Не запускались', played.never, null)}
    </>
  );
}
