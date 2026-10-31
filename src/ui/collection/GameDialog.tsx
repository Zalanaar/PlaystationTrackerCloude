'use client';

import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { GameItem } from '@/server/collection/types';
import type { DetailTab } from './details';
import { Body } from './dialog/Body';
import { Frame } from './dialog/Frame';
import type { DialogHandlers, GameStub } from './dialog/types';

export type { GameStub } from './dialog/types';

const subscribeNoop = () => () => {};

/**
 * Окно игры (design-system §4.15): полноэкранный лист с артом, плитками цифр и вкладками «Обзор» / «Трофеи».
 * Данные шапки и плиток берутся из `game`; список трофеев и даты приходят из GET /api/games/{id}.
 */
export function GameDialog({
  game, stub, startEditing, now, onClose, onStatus, onDate, onHidden, onLoaded, onGameChanged, onNotDuplicate, initialTab, onNotFound,
}: {
  /** Вкладка при открытии (`?tab=trophies`, редкий трофей) */
  initialTab?: DetailTab;
  /** Игры нет (404) и полных данных нет: окно не показывается, родитель убирает ссылку и говорит тостом (§8.6) */
  onNotFound?: () => void;
  game: GameItem | null;
  /** Игра известна только по id и названию: шапка рисуется из stub, плитки появятся после загрузки */
  stub?: GameStub | null;
  startEditing: boolean;
  now: number;
  onClose: () => void;
  /** Полный GameItem из деталей (для stub): родитель подставит его в `game` */
  onLoaded?: (g: GameItem) => void;
} & DialogHandlers) {
  const target = game ?? stub ?? null;
  // портал только после монтирования: окно может быть открыто адресом ?game= уже при гидрации
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  if (!target || !mounted) return null;
  return createPortal(
    <Frame key={target.id} onClose={onClose} tint={game?.tint}>
      {(titleId) => (
        <Body
          key={`${target.id}:${startEditing}`} id={target.id} titleId={titleId} game={game} stub={stub ?? null} startEditing={startEditing} now={now}
          onClose={onClose} onStatus={onStatus} onDate={onDate} onHidden={onHidden} onLoaded={onLoaded} onGameChanged={onGameChanged} onNotDuplicate={onNotDuplicate}
          initialTab={initialTab} onNotFound={onNotFound}
        />
      )}
    </Frame>,
    document.body,
  );
}
