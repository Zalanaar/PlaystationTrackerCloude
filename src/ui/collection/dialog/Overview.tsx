'use client';

import { useId } from 'react';
import type { GameDetailsResponse, GameItem } from '@/server/collection/types';
import { formatDayMonth } from '../../format';
import { Icon } from '../../icons';
import { DurationEditor } from '../DurationEditor';
import { lastPlayedText } from '../details';
import { History } from './History';
import { LinkedVersions } from './LinkedVersions';
import { PlatinumPath } from './PlatinumPath';
import { ReviewEditor } from './ReviewEditor';
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
  game, details, loading, now, onStatus, onHidden, onGameChanged, onNotDuplicate,
}: {
  game: GameItem; details: GameDetailsResponse | null; loading: boolean; now: number;
} & DialogHandlers) {
  const hintId = useId();
  const hidden = !!game.hiddenAt;

  const skeleton = <span className="ps-skeleton ps-gd__sk-val" aria-hidden="true" />;
  const forecast = details?.platinumForecast ?? null;
  // пока детали грузятся, место под прогноз резервируем, если платина в игре есть и не получена
  const forecastPending = loading && !details && game.trophies?.platinumDefined === true && !game.trophies.platinumEarned;
  const dateOr = (iso: string | null | undefined) => (details ? (formatDayMonth(iso ?? null, true) ?? 'нет данных') : loading ? skeleton : 'нет данных');
  return (
    <>
      {/* D-P4: «Путь к платине» — первым блоком «Обзора» */}
      {forecast ? <PlatinumPath f={forecast} /> : forecastPending && (
        <div className="ps-skeleton ps-gd__sk-fc" aria-hidden="true" />
      )}

      {/* F1: оценка и заметка (детали загружены: заметки в GameItem нет) */}
      {details ? (
        <ReviewEditor key={`review-${game.id}`} game={game} review={details.review ?? null} onChanged={onGameChanged} />
      ) : loading && <div className="ps-skeleton ps-gd__sk-review" aria-hidden="true" />}

      {details ? (
        <History history={details.history} lastPlayedAt={game.lastPlayedAt ?? null} now={now} />
      ) : loading && <div className="ps-skeleton ps-gd__sk-hist" aria-hidden="true" />}

      <section className="ps-gd__sec" aria-labelledby="gd-s2">
        <h3 id="gd-s2">Даты</h3>
        <dl>
          <Kv label="Первый запуск">{dateOr(details?.firstPlayedAt)}</Kv>
          <Kv label="Последний запуск">{lastPlayedText(game.lastPlayedAt, now)}</Kv>
          {/* D-P4: блока «Статус и даты» нет — статус в чипе шапки, дата завершения рядом с ним */}
          {game.status !== null && <Kv label="Статус изменён">{dateOr(details?.statusChangedAt)}</Kv>}
          <Kv label="Платформа">PlayStation · {game.platform}</Kv>
          {game.genres.length > 0 && <Kv label="Жанры" className="ps-gd__kv--long">{game.genres.map((g) => g.label).join(', ')}</Kv>}
        </dl>
      </section>

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
