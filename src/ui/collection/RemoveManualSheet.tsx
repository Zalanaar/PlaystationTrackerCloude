'use client';

import { useId, useState } from 'react';
import { Icon } from '../icons';
import { Sheet } from '../primitives/Sheet';
import { manualErrorText, type ManualGame } from './manual';

/** Подтверждение «Убрать из бэклога» (§19.5): alertdialog, фокус при открытии на «Отмена», во время запроса окно не закрывается. */
export function RemoveManualSheet({ game, onClose, onConfirm }: { game: ManualGame | null; onClose: () => void; onConfirm: (g: ManualGame) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descId = useId();

  async function confirm() {
    if (!game || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(game);
    } catch (e) {
      setError(manualErrorText(e, 'Не удалось убрать. Повтори.'));
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (busy) return;
    setError(null);
    onClose();
  }

  return (
    <Sheet open={!!game} onClose={close} title="Убрать из бэклога?" role="alertdialog" describedBy={descId} initialFocus="[data-testid='np-remove-cancel']" busy={busy} className="ps-nb-remove">
      <p id={descId} className="ps-nb-remove__text">Игра «{game?.title}» исчезнет из списка. Её можно снова добавить через поиск.</p>
      {error && <p className="ps-nb-remove__err" role="alert"><Icon name="circle-alert" size={14} />{error}</p>}
      <div className="ps-nb-remove__btns">
        <button type="button" className="ps-btn ps-btn--ghost" data-testid="np-remove-cancel" disabled={busy} onClick={close}>Отмена</button>
        <button type="button" className="ps-btn ps-nb-remove__go" data-testid="np-remove-confirm" disabled={busy} aria-busy={busy || undefined} onClick={() => void confirm()}>
          {busy ? <><Icon name="loader" size={14} className="ps-nb-spin" />Убираю…</> : 'Убрать'}
        </button>
      </div>
    </Sheet>
  );
}
