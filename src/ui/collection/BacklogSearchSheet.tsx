'use client';

// П15.6: лист «Поиск» Бэклога на телефоне (на десктопе поле поиска стоит строкой над фильтрами).
import { Icon } from '../icons';
import { Sheet } from '../primitives/Sheet';
import { BacklogSearch, type SearchPick } from './BacklogSearch';
import type { ManualGame } from './manual';

export function BacklogSearchSheet({ manual, appliedQ, onApply, onPick, onAdded, onOpenStore, onClose }: {
  manual: readonly ManualGame[];
  appliedQ: string;
  onApply: (q: string) => void;
  onPick: (p: SearchPick) => void;
  onAdded: (title: string) => void;
  onOpenStore: (q: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open onClose={onClose} title="Поиск" className="ps-bs-sheet" initialFocus="[data-testid='bs-input']">
      <div className="ps-bs-sheet__body">
        <BacklogSearch
          variant="sheet" manual={manual} appliedQ={appliedQ} onApply={onApply} onPick={onPick}
          onAdded={onAdded} onOpenStore={onOpenStore} onDone={onClose}
        />
      </div>
      <div className="ps-add__foot ps-bs-sheet__foot">
        <p className="ps-rec-note">
          <span>Данные об играх:</span>
          <a className="ps-rec-note__link" href="https://rawg.io" target="_blank" rel="noopener noreferrer" aria-label="RAWG (новая вкладка)">RAWG<Icon name="external-link" size={12} /></a>
        </p>
        <button type="button" className="ps-btn ps-btn--ghost" onClick={onClose}>Закрыть</button>
      </div>
    </Sheet>
  );
}
