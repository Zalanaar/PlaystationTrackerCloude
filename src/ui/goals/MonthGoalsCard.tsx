'use client';

// Цели месяца на главной: выбранные игры («Играю», План на этот месяц, остальной План, Бэклог) и часы; без цели по трофеям.
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import Link from '@/ui/IntentLink';
import { GOAL_PICK_MAX, hasGoals as hasGoalFields, type GoalGame, type MonthGoalsView, type ParsedGoals, type RollAction, type RollKind } from '@/shared/month-goals';
import { STATUSES_CHANGED_EVENT } from '../backup/StatusMenu';
import { Cover } from '../collection/Cover';
import { Icon } from '../icons';
import { Sheet } from '../primitives/Sheet';
import { useEverTrue } from '../useEverTrue';
import { fetchMonthGoals, rollPlannerApi, saveMonthGoalsApi } from './api';
import { barPercent, fieldHint, gamesHintLabel, GOAL_LABEL, GOAL_LIMITS, GOAL_ORDER, hoursHintLabel, monthTitle, parseField, planHoursHintLabel, progressLine, recapSummary, yearGoalBridgeLabel, yearRolloverSummary } from './model';

/** В списке выбора по умолчанию столько строк; остальные — по «Показать ещё» / «Показать все». */
const GOAL_LIST_PREVIEW = 10;

export function MonthGoalsCard() {
  const hid = useId();
  const [data, setData] = useState<MonthGoalsView | null>(null);
  const [gone, setGone] = useState(false);
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState('');
  const [selected, setSelected] = useState<GoalGame[]>([]);
  const [picksTouched, setPicksTouched] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorEver = useEverTrue(open);

  const load = useCallback((signal?: AbortSignal) => {
    return fetchMonthGoals(signal).then(
      (r) => { if (!signal?.aborted) { setData(r); setGone(false); } },
      () => { if (!signal?.aborted) setGone(true); },
    );
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  useEffect(() => {
    const on = () => { void load(); };
    window.addEventListener(STATUSES_CHANGED_EVENT, on);
    return () => window.removeEventListener(STATUSES_CHANGED_EVENT, on);
  }, [load]);

  const catalog = useMemo(() => {
    const m = new Map<number, GoalGame>();
    if (!data) return m;
    for (const g of [...data.picked, ...data.candidates.playing, ...data.candidates.planMonth, ...data.candidates.plan, ...data.candidates.backlog]) m.set(g.id, g);
    return m;
  }, [data]);

  function openEditor() {
    if (!data) return;
    const fresh = !data.hasGoals;
    setSelected(fresh ? data.candidates.planMonth : data.picked);
    setPicksTouched(false);
    setQuery('');
    setHours(
      data.goals.hours != null ? String(data.goals.hours)
        : fresh && data.planHoursHint != null ? String(data.planHoursHint)
        : '',
    );
    setError(null);
    setOpen(true);
  }

  async function save(next: ParsedGoals) {
    setBusy(true); setError(null);
    try {
      const r = await saveMonthGoalsApi(next);
      setData(r);
      setOpen(false);
    } catch {
      setError('Не удалось сохранить. Попробуй ещё раз.');
    } finally { setBusy(false); }
  }

  async function roll(kind: RollKind, action: RollAction) {
    setBusy(true); setError(null);
    try {
      setData(await rollPlannerApi(kind, action));
    } catch {
      setError('Не удалось сохранить. Попробуй ещё раз.');
    } finally { setBusy(false); }
  }

  function toggle(game: GoalGame) {
    setPicksTouched(true);
    setSelected((s) => {
      if (s.some((x) => x.id === game.id)) return s.filter((x) => x.id !== game.id);
      if (s.length >= GOAL_PICK_MAX) return s;
      return [...s, game];
    });
  }

  function submit() {
    if (!data) return;
    const parsed = parseField(hours, 'hours');
    if (!parsed.ok) { setError(fieldHint('hours')); return; }
    const body: ParsedGoals = { games: null, hours: parsed.value, trophies: data.goals.trophies };
    if (selected.length || picksTouched) body.gameIds = selected.map((g) => g.id);
    else body.games = data.goals.games;
    const gamesGoal = body.gameIds ? (body.gameIds.length || null) : body.games;
    if (!hasGoalFields({ games: gamesGoal, hours: body.hours, trophies: null }, body.gameIds?.length ?? 0)) {
      setError('Укажи хотя бы одну цель — или убери все.');
      return;
    }
    void save(body);
  }

  if (gone || !data) return null;

  const title = `Цели на ${monthTitle(data.monthNum)}`;
  const rows = GOAL_ORDER.filter((k) => data.goals[k] != null);
  const selectedIds = new Set(selected.map((g) => g.id));
  const playing = data.candidates.playing.filter((g) => !selectedIds.has(g.id));
  const planMonth = data.candidates.planMonth.filter((g) => !selectedIds.has(g.id));
  const plan = data.candidates.plan.filter((g) => !selectedIds.has(g.id));
  const backlogAll = data.candidates.backlog.filter((g) => !selectedIds.has(g.id));
  const q = query.trim().toLowerCase();
  const backlog = q ? backlogAll.filter((g) => g.title.toLowerCase().includes(q)) : backlogAll;
  const atLimit = selected.length >= GOAL_PICK_MAX;
  const hasCatalog = playing.length + planMonth.length + plan.length + backlogAll.length > 0;
  const showSearch = backlogAll.length >= 8;

  return (
    <>
      {data.recap && (
        <section className="ps-mgoals" data-testid="month-goals-recap">
          <div className="ps-mgoals__head">
            <h2 className="ps-mgoals__t">Как прошёл {monthTitle(data.recap.monthNum)}</h2>
          </div>
          <p className="ps-mgoals__lead" data-testid="month-goals-recap-summary">{recapSummary(data.recap)}</p>
          {data.recap.canCarry && (
            <p className="ps-mgoals__lead">Можно перенести незакрытые игры в цели {monthTitle(data.monthNum)}.</p>
          )}
          {error && <p className="ps-mgoals-form__err">{error}</p>}
          <div className="ps-mgoals__actions">
            {data.recap.canCarry && (
              <button type="button" className="ps-btn ps-btn--primary" disabled={busy} onClick={() => void roll('month', 'carry')} data-testid="month-goals-recap-carry">Перенести незакрытые</button>
            )}
            <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={() => void roll('month', 'dismiss')} data-testid="month-goals-recap-dismiss">{data.recap.canCarry ? 'Закрыть' : 'Понятно'}</button>
          </div>
        </section>
      )}
      {data.yearRollover && (
        <section className="ps-mgoals" data-testid="year-goal-roll">
          <div className="ps-mgoals__head">
            <h2 className="ps-mgoals__t">Новый год</h2>
          </div>
          <p className="ps-mgoals__lead" data-testid="year-goal-roll-summary">{yearRolloverSummary(data.yearRollover)}</p>
          {error && !data.recap && <p className="ps-mgoals-form__err">{error}</p>}
          <div className="ps-mgoals__actions">
            <button type="button" className="ps-btn ps-btn--primary" disabled={busy} onClick={() => void roll('year', 'carry')} data-testid="year-goal-carry">Перенести цель</button>
            <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={() => void roll('year', 'dismiss')} data-testid="year-goal-dismiss">Не переносить</button>
          </div>
        </section>
      )}
      <section className="ps-mgoals" id="month-goals" aria-labelledby={hid} data-testid="month-goals">
        <div className="ps-mgoals__head">
          <h2 id={hid} className="ps-mgoals__t">{title}</h2>
          {data.hasGoals && (
            <button type="button" className="ps-iconbtn ps-mgoals__edit" aria-label="Изменить цели" onClick={openEditor}>
              <Icon name="pencil" size={16} />
            </button>
          )}
        </div>
        {data.hasGoals ? (
          <ul className="ps-mgoals__rows">
            {rows.map((k) => {
              const goal = data.goals[k] as number;
              const current = data.progress[k];
              const pct = barPercent(current, goal);
              const done = current >= goal;
              return (
                <li key={k} className="ps-mgoals__row" data-done={done || undefined} data-testid={`month-goals-${k}`}>
                  <span className="ps-mgoals__lbl">{GOAL_LABEL[k]}</span>
                  <span className="ps-mgoals__val num">{progressLine(k, current, goal)}</span>
                  <span className="ps-mgoals__bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                  {k === 'games' && data.picked.length > 0 && (
                    <ul className="ps-mgoals__picked" data-testid="month-goals-picked">
                      {data.picked.map((g) => (
                        <li key={g.id} data-done={g.completed || undefined}>{g.title}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="ps-mgoals__empty">
            <p className="ps-mgoals__lead">Выбери игры, которые хочешь пройти в этом месяце, и сколько часов наиграть.</p>
            <button type="button" className="ps-btn ps-btn--primary" onClick={openEditor} data-testid="month-goals-set">Задать цель</button>
          </div>
        )}
        {data.yearGoal && (
          <Link href="/roadmap#rm-goal" className="ps-mgoals__year" data-testid="month-goals-year">
            {yearGoalBridgeLabel(data.yearGoal)}
          </Link>
        )}
      </section>
      {editorEver && (
        <Sheet className="ps-mgoals-sheet" open={open} onClose={() => !busy && setOpen(false)} title={title} busy={busy}>
          <form className="ps-mgoals-form" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="ps-mgoals-form__body">
            <p className="ps-mgoals-form__lead">Игры — из «Играю», из Плана на этот месяц и из Бэклога. Часы можно не задавать.</p>

            <fieldset className="ps-mgoals-form__row" data-testid="month-goals-picks">
              <legend className="ps-mgoals-form__lbl">Игры пройти</legend>
              {data.yearGoal?.gamesHint != null && (
                <p className="ps-mgoals-form__h" data-testid="month-goals-games-hint">{gamesHintLabel(data.yearGoal.gamesHint)}</p>
              )}
              {selected.length > 0 && (
                <ul className="ps-mgoals-pick">
                  {selected.map((g) => (
                    <li key={g.id}>
                      <PickRow game={catalog.get(g.id) ?? g} checked onToggle={() => toggle(g)} disabled={busy} />
                    </li>
                  ))}
                </ul>
              )}
              {playing.length > 0 && (
                <PickBlock id={`${hid}-playing`} title="Играю" games={playing} atLimit={atLimit} busy={busy} onToggle={toggle} />
              )}
              {planMonth.length > 0 && (
                <PickBlock id={`${hid}-plan-month`} title={`В плане на ${monthTitle(data.monthNum)}`} games={planMonth} atLimit={atLimit} busy={busy} onToggle={toggle} />
              )}
              {plan.length > 0 && (
                <PickBlock id={`${hid}-plan`} title="План" games={plan} atLimit={atLimit} busy={busy} onToggle={toggle} cap testid="plan" />
              )}
              {backlogAll.length > 0 && (
                <div className="ps-mgoals-pickblock">
                  <p className="ps-mgoals-form__h" id={`${hid}-backlog`}>Бэклог</p>
                  {showSearch && (
                    <input
                      className="ps-input ps-mgoals-form__search" type="search" value={query} disabled={busy}
                      placeholder="Найти в бэклоге" aria-label="Найти в бэклоге" data-testid="month-goals-search"
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  )}
                  {backlog.length > 0 ? (
                    <CappedPickList
                      labelledBy={`${hid}-backlog`}
                      games={backlog}
                      cap={!q}
                      testid="backlog"
                      atLimit={atLimit}
                      busy={busy}
                      onToggle={toggle}
                    />
                  ) : (
                    <p className="ps-mgoals-form__h">Ничего не нашлось.</p>
                  )}
                </div>
              )}
              {selected.length === 0 && !hasCatalog && (
                <p className="ps-mgoals-form__h">Нет игр в «Играю», Плане и Бэклоге — добавь их туда, чтобы выбрать.</p>
              )}
              {atLimit && <p className="ps-mgoals-form__h">Можно выбрать до {GOAL_PICK_MAX} игр.</p>}
            </fieldset>

            <div className="ps-mgoals-form__row">
              <label className="ps-mgoals-form__lbl" htmlFor={`${hid}-hours`}>{GOAL_LABEL.hours}</label>
              <input
                id={`${hid}-hours`} className="ps-input" type="number" inputMode="numeric" min={GOAL_LIMITS.hours.min} max={GOAL_LIMITS.hours.max} step={1}
                value={hours} disabled={busy} data-testid="month-goals-input-hours"
                aria-invalid={hours.trim() !== '' && !parseField(hours, 'hours').ok || undefined} aria-describedby={`${hid}-hours-h`}
                onChange={(e) => setHours(e.target.value)}
              />
              <p className="ps-mgoals-form__h" id={`${hid}-hours-h`}>{fieldHint('hours')}</p>
              {data.planHoursHint != null && (
                <button
                  type="button" className="ps-btn ps-btn--ghost ps-btn--sm" disabled={busy}
                  data-testid="month-goals-plan-hours-hint"
                  onClick={() => setHours(String(data.planHoursHint))}
                >
                  {planHoursHintLabel(data.planHoursHint, data.hoursPerWeek)}
                </button>
              )}
              {data.hoursHint != null && data.hoursHint !== data.planHoursHint && (
                <button
                  type="button" className="ps-btn ps-btn--ghost ps-btn--sm" disabled={busy}
                  data-testid="month-goals-hours-hint"
                  onClick={() => setHours(String(data.hoursHint))}
                >
                  {hoursHintLabel(data.hoursHint)}
                </button>
              )}
            </div>

            {error && <p className="ps-mgoals-form__err" role="alert">{error}</p>}
            </div>
            <div className="ps-mgoals-form__btns" data-testid="month-goals-footer">
              <button type="submit" className="ps-btn ps-btn--primary" disabled={busy} aria-busy={busy || undefined}>Сохранить</button>
              <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={() => setOpen(false)}>Отмена</button>
              {data.hasGoals && (
                <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} data-testid="month-goals-clear" onClick={() => void save({ games: null, hours: null, trophies: null, gameIds: [] })}>
                  Убрать цели
                </button>
              )}
            </div>
          </form>
        </Sheet>
      )}
    </>
  );
}

function PickBlock({ id, title, games, atLimit, busy, onToggle, cap = false, testid }: {
  id: string; title: string; games: GoalGame[]; atLimit: boolean; busy: boolean; onToggle: (g: GoalGame) => void;
  cap?: boolean; testid?: string;
}) {
  return (
    <div className="ps-mgoals-pickblock">
      <p className="ps-mgoals-form__h" id={id}>{title}</p>
      <CappedPickList labelledBy={id} games={games} cap={cap} testid={testid} atLimit={atLimit} busy={busy} onToggle={onToggle} />
    </div>
  );
}

function CappedPickList({ labelledBy, games, cap, testid, atLimit, busy, onToggle }: {
  labelledBy: string; games: GoalGame[]; cap: boolean; testid?: string;
  atLimit: boolean; busy: boolean; onToggle: (g: GoalGame) => void;
}) {
  const [limit, setLimit] = useState(GOAL_LIST_PREVIEW);
  const shouldCap = cap && games.length > GOAL_LIST_PREVIEW;
  const shown = shouldCap ? Math.min(Math.max(limit, GOAL_LIST_PREVIEW), games.length) : games.length;
  const visible = games.slice(0, shown);
  const rest = games.length - visible.length;
  return (
    <>
      <ul className="ps-mgoals-pick" aria-labelledby={labelledBy}>
        {visible.map((g) => (
          <li key={g.id}><PickRow game={g} checked={false} onToggle={() => onToggle(g)} disabled={busy || atLimit} /></li>
        ))}
      </ul>
      {shouldCap && rest > 0 && (
        <div className="ps-mgoals-more">
          <button
            type="button" className="ps-btn ps-btn--ghost" disabled={busy}
            data-testid={testid ? `month-goals-more-${testid}` : undefined}
            onClick={() => setLimit((n) => n + GOAL_LIST_PREVIEW)}
          >
            Показать ещё {Math.min(GOAL_LIST_PREVIEW, rest)}
          </button>
          <button
            type="button" className="ps-btn ps-btn--ghost" disabled={busy}
            data-testid={testid ? `month-goals-all-${testid}` : undefined}
            onClick={() => setLimit(games.length)}
          >
            Показать все ({games.length})
          </button>
        </div>
      )}
      {shouldCap && rest === 0 && (
        <button
          type="button" className="ps-btn ps-btn--ghost" disabled={busy}
          data-testid={testid ? `month-goals-collapse-${testid}` : undefined}
          onClick={() => setLimit(GOAL_LIST_PREVIEW)}
        >
          Свернуть
        </button>
      )}
    </>
  );
}

function PickRow({ game, checked, onToggle, disabled }: { game: GoalGame; checked: boolean; onToggle: () => void; disabled: boolean }) {
  return (
    <button
      type="button" className="ps-mgoals-pick__btn" data-on={checked || undefined} disabled={disabled}
      data-testid={`month-goals-game-${game.id}`} aria-pressed={checked}
      onClick={onToggle}
    >
      <Cover url={game.coverUrl} title={game.title} className="ps-mgoals-pick__cover" w={32} />
      <span className="ps-mgoals-pick__name">{game.title}</span>
      {game.completed && <span className="ps-mgoals-pick__done">пройдено</span>}
      <Icon name={checked ? 'check' : 'plus'} size={16} />
    </button>
  );
}
