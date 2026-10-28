'use client';

import { useId, useState } from 'react';
import { formatNumber, plural } from '../format';
import { Sheet } from '../primitives/Sheet';
import { errorText } from './api';
import { isResetWord, RESET_WORD } from './filters';

/** Подтверждение сброса статусов всей коллекции: текст последствий + ввод слова «СБРОС». */
export function ResetAllDialog({
  open, count, onClose, onConfirm,
}: {
  open: boolean;
  /** сколько видимых игр со статусом; null = сводка не загружена */
  count: number | null;
  onClose: () => void;
  /** бросает ошибку = окно остаётся открытым и показывает её */
  onConfirm: () => Promise<void>;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Сбросить все статусы">
      {open && <Body count={count} onClose={onClose} onConfirm={onConfirm} />}
    </Sheet>
  );
}

function Body({ count, onClose, onConfirm }: { count: number | null; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputId = useId();
  const descId = useId();
  const nothing = count === 0;
  const ok = isResetWord(value) && !nothing;

  async function submit() {
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
    } catch (e) {
      setErr(`Статусы не сброшены. ${errorText(e)}`);
      setBusy(false);
    }
  }

  return (
    <form className="ps-stack ps-reset" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div id={descId} className="ps-reset__text">
        {nothing ? (
          <p>У игр в коллекции нет статусов, сбрасывать нечего.</p>
        ) : (
          <>
            <p>
              {count === null
                ? 'Все игры со статусом останутся без статуса и попадут в «Не разобрано».'
                : <>Статус будет сброшен у <b className="num">{formatNumber(count)}</b> {plural(count, ['игры', 'игр', 'игр'])}: они попадут в «Не разобрано».</>}
            </p>
            <p>Ручные даты прохождения и броска сотрутся. Перед сбросом сохраняется копия: вернуть всё можно кнопкой «Вернуть» в уведомлении после сброса.</p>
            <p>Скрытые игры не затрагиваются.</p>
          </>
        )}
      </div>
      {!nothing && (
        <div className="ps-reset__field">
          <label htmlFor={inputId}>Чтобы подтвердить, введи слово <b>{RESET_WORD}</b></label>
          <input
            id={inputId} className="ps-input" value={value} autoComplete="off" autoCapitalize="characters" spellCheck={false}
            aria-describedby={descId} aria-invalid={err ? true : undefined} onChange={(e) => { setValue(e.target.value); setErr(null); }}
          />
        </div>
      )}
      {err && <p role="alert" className="ps-field-error">{err}</p>}
      <div className="ps-reset__btns">
        <button type="button" className="ps-btn" onClick={onClose}>{nothing ? 'Закрыть' : 'Отмена'}</button>
        {!nothing && (
          <button type="submit" className="ps-btn ps-btn--danger" disabled={!ok || busy}>
            {busy ? 'Сбрасываю…' : 'Сбросить статусы'}
          </button>
        )}
      </div>
    </form>
  );
}
