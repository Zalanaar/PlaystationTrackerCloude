'use client';

import { useEffect, useId, useState } from 'react';
import { Icon } from '../icons';
import { fetchGamePrice, priceErrorText, putGamePrice } from './api';
import { parseRubInput, priceLine } from './model';

/**
 * П13.3: «Цена покупки» в окне игры — сколько заплатил и во сколько обходится час. Пусто — «Указать цену».
 * Высота строки постоянная (скелет того же размера), правка — поле на месте строки.
 */
export function GamePrice({ gameId, hours }: { gameId: number; hours: number }) {
  const hid = useId();
  const [price, setPrice] = useState<number | null | undefined>(undefined);
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchGamePrice(gameId, ac.signal).then(
      (r) => { if (!ac.signal.aborted) setPrice(r.price); },
      (e) => { if (!ac.signal.aborted) { setPrice(null); setError(priceErrorText(e)); } },
    );
    return () => ac.abort();
  }, [gameId]);

  async function save(next: number | null) {
    setBusy(true);
    setError(null);
    try {
      setPrice((await putGamePrice(gameId, next)).price);
      setEdit(null);
    } catch (e) {
      setError(priceErrorText(e));
    } finally {
      setBusy(false);
    }
  }
  const parsed = edit === null ? undefined : parseRubInput(edit);

  return (
    <section className="ps-gd__sec ps-gprice" aria-labelledby={hid} data-testid="gd-price">
      <h3 id={hid}>Цена покупки</h3>
      {price === undefined ? (
        <div className="ps-skeleton ps-gprice__sk" aria-hidden="true" />
      ) : edit !== null ? (
        <form className="ps-gprice__form" onSubmit={(e) => { e.preventDefault(); if (parsed !== undefined) void save(parsed); }}>
          <label className="ps-gprice__field">
            <span className="ps-sr">Цена, ₽</span>
            <input
              className="ps-input" value={edit} inputMode="numeric" autoComplete="off" maxLength={9} placeholder="Например, 3999" autoFocus
              aria-invalid={parsed === undefined || undefined} onChange={(e) => setEdit(e.target.value)} enterKeyHint="done"
            />
            <span className="ps-gprice__cur" aria-hidden="true">₽</span>
          </label>
          <button type="submit" className="ps-btn ps-btn--sm" disabled={busy || parsed === undefined}>Сохранить</button>
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => { setEdit(null); setError(null); }}>Отмена</button>
        </form>
      ) : (
        <div className="ps-gprice__row">
          <span className="ps-gprice__v num" data-testid="gd-price-line">{price === null ? 'Не указана' : priceLine(price, hours)}</span>
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => setEdit(price === null ? '' : String(price))}>
            <Icon name="pencil" size={14} />{price === null ? 'Указать цену' : 'Изменить'}
          </button>
          {price !== null && (
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" disabled={busy} onClick={() => void save(null)}>Убрать</button>
          )}
        </div>
      )}
      {edit !== null && <p className="ps-gprice__hint">Пусто — убрать цену; 0 — игра досталась бесплатно (PS Plus, раздача).</p>}
      {error && <p className="ps-gprice__err" role="alert"><Icon name="circle-alert" size={14} />{error}</p>}
    </section>
  );
}
