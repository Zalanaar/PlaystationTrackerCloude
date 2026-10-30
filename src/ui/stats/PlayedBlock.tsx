'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PlayedBlock as PlayedBlockData, PlayedGroup, PlayedItem, StatsResponse } from '@/server/stats/types';
import { BlockHead, MonthHeader } from '../collection/Chronicle';
import { ApiError, errorText, putMonthExclusion } from '../collection/api';
import { GameCard, type GameActions } from '../collection/GameCard';
import { GameGrid, GameGridItem } from '../collection/GameGrid';
import { MONTH_CHIP_LABELS } from '../collection/monthChips';
import { monthName } from '../format';
import { Icon } from '../icons';
import { useToast } from '../primitives/Toast';
import { MonthActions } from './MonthActions';
import {
  CONFLICT_TEXT, EXCLUDE_FAIL_TEXT, EXCLUDE_TOAST_TTL, RESTORE_FAIL_TEXT, excludedLabel, excludedToast, excludePlan, monthActionLabel, restoredToast, splitHours,
} from './monthExclusion';
import { monthHoursText, type Selection } from './model';
import { pickPlayedMonth } from './playedMonth';

const keyOf = (g: PlayedGroup, i: PlayedItem) => `${g.month}:${i.gameId}`;

/**
 * «Игры месяца» (контракт 10.1 `played`, 15.1): игра в каждом месяце, где в неё играли; фигура только у события месяца.
 * Кнопка «⋯» убирает пару (игра, месяц) из списка; убранные лежат под сеткой свёрнутой строкой.
 */
export function PlayedBlock({
  data, sel, actions, onChanged,
}: { data: StatsResponse; sel: Selection; actions: GameActions; onChanged: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // месяцы, в которых есть игры (или убранные игры, чтобы их можно было вернуть); показывается один выбранный
  const groups = data.played.groups.filter((g) => g.items.length > 0 || (g.excluded?.length ?? 0) > 0);
  const chosen = pickPlayedMonth(groups.map((g) => g.month), sel.period, params.get('m'));
  const games = data.played.games;
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  /** Ручное раскрытие строки «Убрано из месяца»; нет записи = по умолчанию (раскрыта, если в месяце не осталось игр) */
  const [expanded, setExpanded] = useState<Readonly<Record<string, boolean>>>({});

  // «Отменить» и «Повторить» вызывают тот же запрос; через ref, чтобы колбэк не ссылался на себя до объявления
  const again = useRef<(g: PlayedGroup, it: PlayedItem, excluded: boolean, undo?: boolean) => Promise<void>>(async () => {});
  const run = useCallback(async (g: PlayedGroup, it: PlayedItem, excluded: boolean, undo = false): Promise<void> => {
    const k = keyOf(g, it);
    setBusy((b) => new Set(b).add(k));
    try {
      const r = await putMonthExclusion(it.gameId, g.month, excluded);
      if (excluded) {
        toast({
          text: excludedToast(r, g.monthNumber, splitHours(it).real > 0), ttl: EXCLUDE_TOAST_TTL,
          action: undo ? undefined : { label: 'Отменить', run: () => void again.current(g, it, false, true) },
        });
      } else {
        toast({
          text: restoredToast(g.monthNumber), ttl: EXCLUDE_TOAST_TTL,
          action: undo ? undefined : { label: 'Отменить', run: () => void again.current(g, it, true, true) },
        });
      }
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      if (e instanceof ApiError && e.code === 'month_exclusion_conflict') {
        toast({ kind: 'error', text: CONFLICT_TEXT, ttl: EXCLUDE_TOAST_TTL });
      } else {
        const base = excluded ? EXCLUDE_FAIL_TEXT : RESTORE_FAIL_TEXT;
        toast({
          kind: 'error', text: e instanceof ApiError && e.status !== 0 && e.status !== 503 ? `${base}. ${errorText(e)}` : base, ttl: EXCLUDE_TOAST_TTL,
          action: { label: 'Повторить', run: () => void again.current(g, it, excluded, undo) },
        });
      }
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(k);
        return n;
      });
    }
  }, [onChanged, toast]);
  useEffect(() => { again.current = run; }, [run]);

  if (groups.length === 0 || chosen === null) return null;
  const pick = (month: string) => {
    const p = new URLSearchParams(params.toString());
    p.set('m', month);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const current = groups.find((g) => g.month === chosen);
  return (
    <section className="ps-st-played" aria-labelledby="st-played" id="st-played-sec">
      <BlockHead id="st-played" title="Игры месяца" count={current?.items.length ?? 0} />
      {sel.period === 'year' && groups.length > 1 && (
        <div className="ps-mchips ps-mchips--static" role="group" aria-label="Месяц">
          {[...groups].sort((a, b) => b.month.localeCompare(a.month)).map((g) => (
            <button
              key={g.month} type="button" className="ps-chip ps-mchip" aria-pressed={g.month === chosen}
              aria-label={`${monthName(g.monthNumber)}: ${g.items.length} ${g.items.length === 1 ? 'игра' : 'игр'}`} onClick={() => pick(g.month)}
            >
              {MONTH_CHIP_LABELS[g.monthNumber - 1]}<small className="num">{g.items.length}</small>
            </button>
          ))}
        </div>
      )}
      {(current ? [current] : []).map((g) => {
        const excluded = g.excluded ?? [];
        const label = `Игры: ${monthName(g.monthNumber)}${sel.period === 'year' ? ` ${g.year}` : ''}`;
        const open = expanded[g.month] ?? g.items.length === 0;
        return (
          <div key={g.month} className="ps-st-played__month">
            <MonthHeader m={{ month: g.monthNumber, completed: g.completed, dropped: g.dropped }} games={g.items.length} />
            {g.items.length > 0 ? (
              <GameGrid density="dense" label={label}>
                {g.items.map((i) => {
                  const game = games[String(i.gameId)];
                  if (!game) return null;
                  const h = monthHoursText(i.hours, i.estimated);
                  const k = keyOf(g, i);
                  return (
                    <GameGridItem key={k}>
                      <GameCard
                        game={game} actions={actions} selectMode={false} selected={false} busy={busy.has(k)}
                        month={{ finished: i.finished, finishedAt: i.finishedAt, hoursText: h?.text ?? null, hoursLabel: h?.label ?? null }}
                        monthMenu={(
                          <MonthActions
                            label={monthActionLabel(game.title, g.monthNumber)} excluded={false} busy={busy.has(k)} plan={excludePlan(i, g.monthNumber)}
                            onExclude={() => void run(g, i, true)} onRestore={() => {}}
                          />
                        )}
                      />
                    </GameGridItem>
                  );
                })}
              </GameGrid>
            ) : (
              <p className="ps-st-played__none">Все игры этого месяца убраны</p>
            )}
            {excluded.length > 0 && (
              <ExcludedList
                group={g} items={excluded} games={games} open={open} busy={busy} actions={actions}
                onToggle={() => setExpanded((e) => ({ ...e, [g.month]: !open }))} onRestore={(i) => void run(g, i, false)}
              />
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Строка «Убрано из месяца: N» и свёрнутая сетка убранных игр с «Вернуть в месяц» (спека п.5.3). */
function ExcludedList({
  group, items, games, open, busy, actions, onToggle, onRestore,
}: {
  group: PlayedGroup; games: PlayedBlockData['games']; items: PlayedItem[]; open: boolean; busy: ReadonlySet<string>; actions: GameActions;
  onToggle: () => void; onRestore: (i: PlayedItem) => void;
}) {
  const id = useId();
  return (
    <div className="ps-st-excl-wrap">
      <button type="button" className="ps-st-excl" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <Icon name="calendar-x" size={14} />
        <span>{excludedLabel(items.length)}</span>
        <Icon name="chevron-down" size={14} className="ps-st-excl__chev" />
      </button>
      <div id={id} className="ps-st-excl__body" data-open={open} inert={!open}>
        <div className="ps-st-excl__in">
          <GameGrid density="dense" label={`Убрано из месяца: ${monthName(group.monthNumber)}`}>
            {items.map((i) => {
              const game = games[String(i.gameId)];
              if (!game) return null;
              const h = monthHoursText(i.hours, false);
              const k = keyOf(group, i);
              return (
                <GameGridItem key={k}>
                  <GameCard
                    game={game} actions={actions} selectMode={false} selected={false} busy={busy.has(k)}
                    month={{ finished: i.finished, finishedAt: i.finishedAt, hoursText: h?.text ?? null, hoursLabel: h?.label ?? null, excluded: true }}
                    monthMenu={(
                      <MonthActions
                        label={monthActionLabel(game.title, group.monthNumber)} excluded busy={busy.has(k)} plan={{ kind: 'silent' }}
                        onExclude={() => {}} onRestore={() => onRestore(i)}
                      />
                    )}
                  />
                </GameGridItem>
              );
            })}
          </GameGrid>
          <p className="ps-st-excl__note"><Icon name="info" size={12} />Измеренные часы этих игр остаются в статистике месяца. Убрано только из списка и оценочных часов.</p>
        </div>
      </div>
    </div>
  );
}
