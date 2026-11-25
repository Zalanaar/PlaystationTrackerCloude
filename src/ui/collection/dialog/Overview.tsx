'use client';

import { useId, useMemo, useState } from 'react';
import type { DiaryEntry } from '@/shared/diary';
import type { GameDetailsResponse, GameItem } from '@/server/collection/types';
import { formatDayMonth } from '../../format';
import { Icon } from '../../icons';
import { DurationEditor } from '../DurationEditor';
import { lastPlayedText } from '../details';
import { History } from './History';
import { historyView } from '../history';
import { LinkedVersions } from './LinkedVersions';
import { PlatinumPath } from './PlatinumPath';
import { DlcProgress } from './DlcProgress';
import { dlcProgress } from '../trophies';
import { DiaryEditor } from '../../diary/DiaryEditor';
import { ReviewEditor } from './ReviewEditor';
import { GameTags } from '../../tags/GameTags';
import type { DialogHandlers } from './types';
import { Fold } from './Fold';

function Kv({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`ps-gd__kv ${className ?? ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Overview({
  game, details, loading, now, onStatus, onHidden, onGameChanged, onNotDuplicate, onOpenTrophies,
}: {
  game: GameItem; details: GameDetailsResponse | null; loading: boolean; now: number; onOpenTrophies?: (sectionKey: string) => void;
} & DialogHandlers) {
  const hintId = useId();
  const hidden = !!game.hiddenAt;
  const [editedDiary, setEditedDiary] = useState<{ gameId: number; entries: DiaryEntry[] } | null>(null);
  const diary = editedDiary?.gameId === game.id ? editedDiary.entries : (details?.diary ?? []);

  const skeleton = <span className="ps-skeleton ps-gd__sk-val" aria-hidden="true" />;
  const forecast = details?.platinumForecast ?? null;
  const dlc = useMemo(() => (details ? dlcProgress(details.trophyList, details.trophyGroups ?? []) : null), [details]);
  // пока детали грузятся, место под прогноз резервируем, если платина в игре есть и не получена
  const forecastPending = loading && !details && game.trophies?.platinumDefined === true && !game.trophies.platinumEarned;
  const dateOr = (iso: string | null | undefined) => (details ? (formatDayMonth(iso ?? null, true) ?? 'нет данных') : loading ? skeleton : 'нет данных');
  // П15.1: на широком экране «Обзор» в две колонки — слева прогресс, оценка и история, справа даты и управление.
  // На телефоне и планшете обёртки «прозрачны» (display: contents) — порядок блоков прежний.
  return (
    <>
      <div className="ps-gd__ovmain">
      {/* П.7 (t281u): сверху оценка и дневник (статус и часы — в шапке окна), затем прогресс; история свёрнута */}
      {details ? (
        <>
        <ReviewEditor key={`review-${game.id}`} game={game} review={details.review ?? null} onChanged={onGameChanged} withNote={false} />
        <DiaryEditor key={`diary-${game.id}`} gameId={game.id} entries={diary} onEntries={(entries) => setEditedDiary({ gameId: game.id, entries })} />
        </>
      ) : loading && <div className="ps-skeleton ps-gd__sk-review" aria-hidden="true" />}

      {/* D-P4: «Путь к платине» */}
      {forecast ? <PlatinumPath f={forecast} /> : forecastPending && (
        <div className="ps-skeleton ps-gd__sk-fc" aria-hidden="true" />
      )}

      {/* Пакет 7, п. 1: прогресс по основной игре и каждому DLC, незакрытые дополнения — мини-бэклог */}
      {dlc && <DlcProgress data={dlc} onOpen={onOpenTrophies} />}

      {details ? historyView(details.history) && (
        <Fold id="history" title="История" testId="gd-fold-history">
          <History history={details.history} lastPlayedAt={game.lastPlayedAt ?? null} now={now} />
        </Fold>
      ) : loading && <div className="ps-skeleton ps-gd__sk-fold" aria-hidden="true" />}
      </div>

      <div className="ps-gd__ovside">
      <Fold id="more" title="Подробнее" hint="даты, теги, управление" testId="gd-fold-more" force={hidden}>
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

      {/* П13.2: свои теги (только у видимой игры: на скрытую и дубль теги не вешаются) */}
      {onGameChanged && !hidden && <GameTags key={`tags-${game.id}`} gameId={game.id} />}

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
      </Fold>
      </div>
    </>
  );
}
