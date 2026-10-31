'use client';

import { useId, useState } from 'react';
import type { GameDetailsResponse, GameItem } from '@/server/collection/types';
import { formatDate, formatDayMonth } from '../../format';
import { Icon, StatusGlyph } from '../../icons';
import { toKey } from '../../status';
import { STATUS_META } from '../../tokens';
import { DurationEditor } from '../DurationEditor';
import { doneLabel, lastPlayedText } from '../details';
import { completionInfo, dateInputToIso, isoToDateInput } from '../filters';
import { LinkedVersions } from './LinkedVersions';
import { PlatinumPath } from './PlatinumPath';
import type { DialogHandlers } from './types';

function Kv({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`ps-gd__kv ${className ?? ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Overview({
  game, details, loading, startEditing, now, onStatus, onDate, onHidden, onGameChanged, onNotDuplicate,
}: {
  game: GameItem; details: GameDetailsResponse | null; loading: boolean; startEditing: boolean; now: number;
} & DialogHandlers) {
  const hintId = useId();
  const hidden = !!game.hiddenAt;
  const done = completionInfo(game);
  const [editing, setEditing] = useState(startEditing && !!done);
  const [value, setValue] = useState(isoToDateInput(done?.iso));
  const [err, setErr] = useState<string | null>(null);
  const today = isoToDateInput(new Date(now).toISOString());

  function save() {
    if (!done) return;
    const iso = dateInputToIso(value, now);
    if (!iso) {
      setErr('Укажи дату целиком.');
      return;
    }
    onDate(game, done.kind, iso);
    setEditing(false);
  }

  const skeleton = <span className="ps-skeleton ps-gd__sk-val" aria-hidden="true" />;
  const forecast = details?.platinumForecast ?? null;
  // пока детали грузятся, место под прогноз резервируем, если платина в игре есть и не получена
  const forecastPending = loading && !details && game.trophies?.platinumDefined === true && !game.trophies.platinumEarned;
  const dateOr = (iso: string | null | undefined) => (details ? (formatDayMonth(iso ?? null, true) ?? 'нет данных') : loading ? skeleton : 'нет данных');
  return (
    <>
      <div className="ps-gd__cols">
        <section className="ps-gd__sec" aria-labelledby="gd-s1">
          <h3 id="gd-s1">Статус и даты</h3>
          <dl>
            <Kv label="Статус"><span className="ps-gd__st"><StatusGlyph status={toKey(game.status)} size={16} />{STATUS_META[toKey(game.status)].label}</span></Kv>
            {done && (
              <Kv label={doneLabel(done.kind)} className={editing ? 'ps-gd__kv--edit' : undefined}>
                {editing ? (
                  <form className="ps-inline-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
                    <input type="date" className="ps-input" value={value} max={today} aria-label="Дата завершения" onChange={(e) => { setValue(e.target.value); setErr(null); }} />
                    <button type="submit" aria-label="Сохранить дату завершения" className="ps-btn ps-btn--primary">Сохранить</button>
                    <button type="button" className="ps-btn" onClick={() => setEditing(false)}>Отмена</button>
                    {err && <span role="alert" className="ps-field-error">{err}</span>}
                  </form>
                ) : (
                  <>
                    {formatDate(done.iso)}{' '}
                    <button type="button" className="ps-link" onClick={() => setEditing(true)}>Изменить</button>
                  </>
                )}
              </Kv>
            )}
            <Kv label="Статус изменён">{dateOr(details?.statusChangedAt)}</Kv>
          </dl>
        </section>
        <section className="ps-gd__sec" aria-labelledby="gd-s2">
          <h3 id="gd-s2">Запуски</h3>
          <dl>
            <Kv label="Первый запуск">{dateOr(details?.firstPlayedAt)}</Kv>
            <Kv label="Последний запуск">{lastPlayedText(game.lastPlayedAt, now)}</Kv>
            <Kv label="Платформа">PlayStation · {game.platform}</Kv>
            {game.genres.length > 0 && <Kv label="Жанры" className="ps-gd__kv--long">{game.genres.map((g) => g.label).join(', ')}</Kv>}
          </dl>
        </section>
      </div>

      {forecast ? <PlatinumPath f={forecast} /> : forecastPending && (
        <div className="ps-skeleton ps-gd__sk-fc" aria-hidden="true" />
      )}

      {onNotDuplicate && <LinkedVersions game={game} onSplit={onNotDuplicate} />}

      {onGameChanged && game.duration && <DurationEditor key={game.id} game={game} onChanged={onGameChanged} />}

      {(game.status !== null || onHidden || hidden) && (
        <section className="ps-gd__sec ps-gd__manage" aria-labelledby="gd-s4">
          <h3 id="gd-s4">Управление</h3>
          {hidden && <dl><Kv label="Убрана из коллекции">{formatDayMonth(game.hiddenAt ?? null, true)}</Kv></dl>}
          <div className="ps-gd__actions">
            {game.status !== null && (
              <button type="button" className="ps-btn ps-btn--ghost" onClick={() => onStatus(game, null)}>
                <Icon name="undo" size={16} />Сбросить статус
              </button>
            )}
            {onHidden && (hidden ? (
              <button type="button" className="ps-btn" onClick={() => onHidden(game, false)}>
                <Icon name="undo" size={16} />Вернуть в коллекцию
              </button>
            ) : (
              <button type="button" className="ps-btn ps-btn--ghost ps-btn--danger" aria-describedby={hintId} onClick={() => onHidden(game, true)}>
                <Icon name="eye-off" size={16} />Убрать из коллекции
              </button>
            ))}
          </div>
          {onHidden && !hidden && <p className="ps-detail__hint" id={hintId}>Игра не будет показываться нигде, синк её не вернёт.</p>}
        </section>
      )}
    </>
  );
}
