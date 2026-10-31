import type { GameItem, GameStatusValue } from '@/server/collection/types';

/** Минимум данных об игре, пока полный `GameItem` ещё не получен (открытие из поповера жанров). */
export type GameStub = { id: number; title: string; coverUrl: string | null };

/** Обработчики окна игры: приходят от родителя и пробрасываются в Body и Overview. */
export type DialogHandlers = {
  onStatus: (g: GameItem, s: GameStatusValue | null) => void;
  onDate: (g: GameItem, kind: 'completed' | 'dropped', iso: string) => void;
  /** Убрать из коллекции / вернуть (9.7). Нет обработчика = кнопки нет. */
  onHidden?: (g: GameItem, hidden: boolean) => void;
  /** Игра изменена внутри окна (ручная длительность, 16.5): родитель подставит её в список. Нет обработчика = блока длительности нет. */
  onGameChanged?: (g: GameItem) => void;
  /** Версии разделены кнопкой «Это не дубль» (Фаза 23): родитель подставит игру и перечитает списки. Нет обработчика = блока нет. */
  onNotDuplicate?: (g: GameItem) => void;
};
