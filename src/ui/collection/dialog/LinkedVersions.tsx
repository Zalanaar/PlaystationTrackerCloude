'use client';

import { useId, useState } from 'react';
import type { GameItem } from '@/server/collection/types';
import { ApiError, errorText, postNotDuplicate } from '../api';
import { linkedHoursText, linkedVersionsOf, type LinkedVersion } from '../linked';

/** Чистая разметка блока: список версий и кнопка «Это не дубль» с подтверждением (без состояния запроса). */
export function LinkedVersionsView({
  versions, confirming, busy, err, onAsk, onCancel, onConfirm,
}: {
  versions: LinkedVersion[]; confirming: boolean; busy: boolean; err: string | null;
  onAsk: () => void; onCancel: () => void; onConfirm: () => void;
}) {
  const hintId = useId();
  if (versions.length === 0) return null;
  return (
    <section className="ps-gd__sec ps-gd__linked" aria-labelledby="gd-linked" data-testid="linked-versions">
      <h3 id="gd-linked">Связанные версии</h3>
      <ul className="ps-gd__linked-list">
        {versions.map((v) => (
          <li key={v.gameId} className="ps-gd__linked-item">
            <span className="ps-gd__linked-title">{v.title}</span>
            <span className="ps-gd__linked-plat">{v.platform}</span>
            <span className="ps-gd__linked-hours num">{linkedHoursText(v.hours)}</span>
          </li>
        ))}
      </ul>
      <p className="ps-detail__hint" id={hintId}>Часы этих версий входят в одну карточку.</p>
      {confirming ? (
        <div className="ps-gd__actions" role="group" aria-label="Подтверждение">
          <span className="ps-gd__linked-ask">Показывать версии отдельными карточками?</span>
          <button type="button" className="ps-btn ps-btn--primary" disabled={busy} onClick={onConfirm}>{busy ? 'Разделяю…' : 'Да, разделить'}</button>
          <button type="button" className="ps-btn" disabled={busy} onClick={onCancel}>Отмена</button>
        </div>
      ) : (
        <div className="ps-gd__actions">
          <button type="button" className="ps-btn ps-btn--ghost" aria-describedby={hintId} onClick={onAsk}>Это не дубль</button>
        </div>
      )}
      {err && <p role="alert" className="ps-field-error">{err}</p>}
    </section>
  );
}

/** Блок «Связанные версии» в окне игры (Фаза 23). Показывается только у главной игры с версиями. */
export function LinkedVersions({ game, onSplit }: { game: GameItem; onSplit: (g: GameItem) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      const r = await postNotDuplicate(game.id);
      setConfirming(false);
      onSplit(r.game);
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 409 ? 'Версии уже разделены. Обнови страницу.' : `Не удалось разделить. ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <LinkedVersionsView
      versions={linkedVersionsOf(game)} confirming={confirming} busy={busy} err={err}
      onAsk={() => { setErr(null); setConfirming(true); }} onCancel={() => setConfirming(false)} onConfirm={() => void confirm()}
    />
  );
}
