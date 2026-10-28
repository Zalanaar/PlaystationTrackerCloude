'use client';

import { useId, useState } from 'react';
import type { GameItem, GameStatusValue } from '@/server/collection/types';
import { formatDate, formatDateLong, formatPlayTime, launchesText, relativeAgo } from '../format';
import { Icon } from '../icons';
import { Sheet } from '../primitives/Sheet';
import { StatusChip, StatusMenu } from '../status';
import { Cover } from './Cover';
import { completionInfo, dateInputToIso, isoToDateInput } from './filters';

/** Карточка игры в окне: детали, смена статуса, правка даты завершения. */
export function GameDialog({
  game, startEditing, now, onClose, onStatus, onDate, onHidden,
}: {
  game: GameItem | null;
  startEditing: boolean;
  now: number;
  onClose: () => void;
  onStatus: (g: GameItem, s: GameStatusValue | null) => void;
  onDate: (g: GameItem, kind: 'completed' | 'dropped', iso: string) => void;
  /** Убрать из коллекции / вернуть (9.7). Нет обработчика = кнопки нет. */
  onHidden?: (g: GameItem, hidden: boolean) => void;
}) {
  return (
    <Sheet open={game !== null} onClose={onClose} title={game?.title ?? ''} wide>
      {game && <Body key={`${game.id}:${startEditing}`} game={game} startEditing={startEditing} now={now} onStatus={onStatus} onDate={onDate} onHidden={onHidden} />}
    </Sheet>
  );
}

function Body({
  game, startEditing, now, onStatus, onDate, onHidden,
}: {
  game: GameItem; startEditing: boolean; now: number;
  onStatus: (g: GameItem, s: GameStatusValue | null) => void;
  onDate: (g: GameItem, kind: 'completed' | 'dropped', iso: string) => void;
  onHidden?: (g: GameItem, hidden: boolean) => void;
}) {
  const hintId = useId();
  const hidden = !!game.hiddenAt;
  const done = completionInfo(game);
  const [editing, setEditing] = useState(startEditing && !!done);
  const [value, setValue] = useState(isoToDateInput(done?.iso));
  const [err, setErr] = useState<string | null>(null);
  const time = formatPlayTime(game.playSeconds);
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

  const t = game.trophies;
  return (
    <div className="ps-detail">
      <Cover url={game.coverUrl} title={game.title} className="ps-detail__cover" />
      <div className="ps-detail__main">
        <dl className="ps-detail__meta">
          <div><dt>Статус</dt>
            <dd>
              <StatusMenu value={game.status} onPick={(s) => onStatus(game, s)} label="Изменить статус">
                <StatusChip status={game.status} /><Icon name="chevron-down" size={14} />
              </StatusMenu>
            </dd>
          </div>
          {done && (
            <div><dt>{done.kind === 'completed' ? 'Дата прохождения' : 'Дата броска'}</dt>
              <dd>
                {editing ? (
                  <form className="ps-inline-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
                    <input type="date" className="ps-input" value={value} max={today} aria-label="Дата завершения" onChange={(e) => { setValue(e.target.value); setErr(null); }} />
                    <button type="submit" className="ps-btn ps-btn--primary">Сохранить</button>
                    <button type="button" className="ps-btn" onClick={() => setEditing(false)}>Отмена</button>
                    {err && <span role="alert" className="ps-field-error">{err}</span>}
                  </form>
                ) : (
                  <>
                    {formatDate(done.iso)}{' '}
                    <button type="button" className="ps-link" onClick={() => setEditing(true)}>Изменить</button>
                  </>
                )}
              </dd>
            </div>
          )}
          <div><dt>Платформа</dt><dd>PlayStation · {game.platform}</dd></div>
          {game.genres.length > 0 && <div><dt>Жанры</dt><dd>{game.genres.map((g) => g.label).join(', ')}</dd></div>}
          <div><dt>Наиграно</dt><dd>{time ?? 'нет данных'}{game.playCount > 0 ? ` · ${launchesText(game.playCount)}` : ''}</dd></div>
          <div><dt>Последний запуск</dt><dd>{formatDateLong(game.lastPlayedAt) ?? 'нет данных'}{game.lastPlayedAt ? ` (${relativeAgo(game.lastPlayedAt, now)})` : ''}</dd></div>
          <div><dt>Трофеи</dt><dd>{t ? `${t.earned} из ${t.defined} · ${t.progress}%${t.platinumEarned ? ' · платина' : ''}` : 'нет данных'}</dd></div>
          {hidden && <div><dt>Убрана из коллекции</dt><dd>{formatDateLong(game.hiddenAt ?? null)}</dd></div>}
        </dl>
        {(game.status !== null || onHidden) && (
          <div className="ps-detail__actions">
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
              <>
                <button type="button" className="ps-btn ps-btn--ghost ps-btn--danger" aria-describedby={hintId} onClick={() => onHidden(game, true)}>
                  <Icon name="eye-off" size={16} />Убрать из коллекции
                </button>
                <p className="ps-detail__hint" id={hintId}>Игра не будет показываться нигде, синк её не вернёт.</p>
              </>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
