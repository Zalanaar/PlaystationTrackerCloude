import type { Dispatch, SetStateAction } from 'react';
import type { GameItem, StatusCounts } from '@/server/collection/types';
import type { ViewMode } from '../../tokens';
import type { BlockId } from '../blocks';
import type { groupByLastPlayedYear, groupChronicle } from '../chronicle';
import type { Filters } from '../filters';
import type { GameActions } from '../GameCard';

/** Всё, что нужно функциям отрисовки списков коллекции: собирается в CollectionView и передаётся первым аргументом. */
export type RenderCtx = {
  view: ViewMode;
  density: Exclude<ViewMode, 'list'>;
  cols: number;
  filters: Filters;
  actions: GameActions;
  selectMode: boolean;
  selected: Set<number>;
  hiddenView: boolean;
  setFilters: (p: Partial<Filters>) => void;
  setHidden: (g: GameItem, hidden: boolean) => Promise<void>;
  counts: StatusCounts;
  /** 14.4: забытых во всей коллекции */
  forgotten: number;
  /** Фаза 27: сколько подсказок смены статуса (0 = чип «Проверить статусы» не показываем) */
  checkCount: number;
  more: boolean;
  loadMore: (block: BlockId | null) => Promise<void>;
  byBlock: Record<BlockId, GameItem[]>;
  chron: ReturnType<typeof groupChronicle>;
  played: ReturnType<typeof groupByLastPlayedYear>;
  isOpen: (key: string | number) => boolean;
  toggle: (key: string | number) => void;
  isPlayedOpen: (key: string) => boolean;
  togglePlayed: (key: string) => void;
  rawLoaded: (b: BlockId) => number;
  shownCount: (serverCount: number, list: GameItem[]) => number;
  serviceFull: boolean;
  serviceOpen: boolean;
  setServiceOpen: Dispatch<SetStateAction<boolean>>;
  serviceRows: number;
  setServiceRows: Dispatch<SetStateAction<number>>;
};
