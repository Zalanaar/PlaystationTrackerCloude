'use client';

import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon, StatusIcon } from '../icons';
import { cssUrl } from '../format';
import { STATUS_META } from '../tokens';
import { Cover, THUMB_W } from '../collection/Cover';
import { Art } from '../collection/dialog/Art';
import { Frame } from '../collection/dialog/Frame';
import { ReviewEditor } from '../collection/dialog/ReviewEditor';
import { updateOtherPlatform, type OtherPatchBody, type OtherPlatformGame } from './api';
import { OTHER_STATUS_ORDER, PLATFORM_CHIPS, platformChip } from './block';

const subscribeNoop = () => () => {};

/**
 * Пакет 5 (спека 5.6): то же окно игры (Frame, арт, обложка, плитки), но правятся только платформа и статус △ ○ □ ✕,
 * плюс «Моя оценка» 0–10 и заметка. Часы и трофеи — «нет». Удаление записи — кнопкой внизу.
 */
export function OtherPlatformDialog({ game, onClose, onChanged, onRemove }: {
  game: OtherPlatformGame | null;
  onClose: () => void;
  onChanged: (g: OtherPlatformGame) => void;
  onRemove: (g: OtherPlatformGame) => void;
}) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  if (!game || !mounted) return null;
  return createPortal(
    <Frame key={game.id} onClose={onClose}>
      {(titleId) => <Body game={game} titleId={titleId} onClose={onClose} onChanged={onChanged} onRemove={onRemove} />}
    </Frame>,
    document.body,
  );
}

function Body({ game, titleId, onClose, onChanged, onRemove }: {
  game: OtherPlatformGame; titleId: string; onClose: () => void; onChanged: (g: OtherPlatformGame) => void; onRemove: (g: OtherPlatformGame) => void;
}) {
  const [busy, setBusy] = useState<'platform' | 'status' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const hasCover = !!cssUrl(game.coverUrl);
  const chip = platformChip(game.platformLabel);

  async function patch(kind: 'platform' | 'status', body: OtherPatchBody) {
    setBusy(kind);
    setErr(null);
    try {
      const r = await updateOtherPlatform(game.id, body);
      onChanged(r.item);
    } catch {
      setErr('Не сохранено. Повтори.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ps-gd__col" data-testid="op-dialog">
      <div className="ps-gd__closewrap">
        <button type="button" className="ps-gd__close" onClick={onClose} aria-label="Закрыть">
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="ps-gd__hero" data-art={hasCover ? 'blur' : 'none'}>
        <div className="ps-gd__stage">
          <Art mode={hasCover ? 'blur' : 'none'} bannerUrl={null} coverUrl={hasCover ? game.coverUrl : null} loading={false} onBannerError={() => {}} />
          <Cover url={game.coverUrl} title={game.title} className="ps-gd__cover" w={THUMB_W} />
          <div className="ps-gd__tt">
            <div className="ps-gd__titlerow"><h2 id={titleId} className="ps-gd__title">{game.title}</h2></div>
            <p className="ps-gd__sub" data-testid="op-dialog-sub">{game.platformLabel ?? 'Платформа не указана'} · не PlayStation</p>
          </div>
        </div>
      </div>

      <ul className="ps-gd__tiles ps-opd__tiles" role="list">
        <li className="ps-gd__tile" data-muted aria-label="Часы: нет"><span className="ps-gd__tl" aria-hidden="true">Часы</span><span className="ps-gd__tv" aria-hidden="true">нет</span></li>
        <li className="ps-gd__tile" data-muted aria-label="Трофеи: нет"><span className="ps-gd__tl" aria-hidden="true">Трофеи</span><span className="ps-gd__tv" aria-hidden="true">нет</span></li>
      </ul>

      <div className="ps-gd__panel ps-opd" data-tab="overview">
        <section className="ps-gd__sec" aria-labelledby={`${titleId}-plat`}>
          <h3 id={`${titleId}-plat`}>Платформа</h3>
          <div className="ps-opd__chips" role="group" aria-labelledby={`${titleId}-plat`} data-testid="op-platform-chips" aria-busy={busy === 'platform' || undefined}>
            {PLATFORM_CHIPS.map((p) => (
              <button
                key={p} type="button" className="ps-filterchip ps-chip ps-opd__chip" aria-pressed={chip === p} data-platform={p} disabled={busy !== null}
                onClick={() => { if (chip !== p) void patch('platform', { platformLabel: p }); }}
              >{p}</button>
            ))}
            <button
              type="button" className="ps-filterchip ps-chip ps-opd__chip" aria-pressed={game.platformLabel === null} data-platform="none" disabled={busy !== null}
              onClick={() => { if (game.platformLabel !== null) void patch('platform', { platformLabel: null }); }}
            >нет</button>
          </div>
          {game.platformLabel && !chip && <p className="ps-opd__hint">Сейчас: {game.platformLabel}</p>}
        </section>

        <section className="ps-gd__sec" aria-labelledby={`${titleId}-st`}>
          <h3 id={`${titleId}-st`}>Статус</h3>
          <div className="ps-opd__chips" role="group" aria-labelledby={`${titleId}-st`} data-testid="op-status-chips" aria-busy={busy === 'status' || undefined}>
            {OTHER_STATUS_ORDER.map((s) => (
              <button
                key={s} type="button" className="ps-filterchip ps-chip ps-opd__chip" aria-pressed={game.status === s} data-status={s} disabled={busy !== null}
                onClick={() => { if (game.status !== s) void patch('status', { status: s }); }}
              ><StatusIcon status={s} size={16} />{STATUS_META[s].label}</button>
            ))}
            <button
              type="button" className="ps-filterchip ps-chip ps-opd__chip" aria-pressed={game.status === null} data-status="none" disabled={busy !== null}
              onClick={() => { if (game.status !== null) void patch('status', { status: null }); }}
            >нет</button>
          </div>
          <p className="ps-opd__err" role="status" data-testid="op-dialog-err">{err ?? ''}</p>
        </section>

        <ReviewEditor
          key={`op-review-${game.id}`} review={{ rating: game.rating, note: game.note }}
          save={async (v, keepalive) => {
            const r = await updateOtherPlatform(game.id, { rating: v.rating, note: v.note }, keepalive ? { keepalive: true } : undefined);
            onChanged(r.item);
            return { rating: r.item.rating, note: r.item.note };
          }}
        />

        <p className="ps-opd__note">Не попадает в Статистику, Итоги и счётчики. Мы не предлагаем эту игру в «У тебя нет» и в Плане.</p>
        <button type="button" className="ps-btn ps-btn--ghost ps-opd__rm" data-testid="op-dialog-remove" onClick={() => onRemove(game)}>
          <Icon name="trash" size={16} />Удалить из коллекции
        </button>
      </div>
    </div>
  );
}
