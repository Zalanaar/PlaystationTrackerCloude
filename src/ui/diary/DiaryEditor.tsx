'use client';

// Дневник прохождения: несколько датированных коротких заметок вместо одного поля.
import { useId, useState } from 'react';
import type { DiaryEntry } from '@/shared/diary';
import { DIARY_NOTE_MAX } from '@/shared/diary';
import { noteLength } from '@/shared/review';
import { deleteDiaryEntry, errorText, postDiary } from '../collection/api';
import { formatDayMonth } from '../format';
import { Icon } from '../icons';
import { useToast } from '../primitives/Toast';

export function DiaryEditor({ gameId, entries: initial, onChanged, onEntries }: { gameId: number; entries: DiaryEntry[]; onChanged?: () => void; onEntries?: (entries: DiaryEntry[]) => void }) {
  const [entries, setEntries] = useState(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const id = useId();
  const len = noteLength(text);
  const tooLong = len > DIARY_NOTE_MAX;
  const canAdd = text.trim().length > 0 && !tooLong && !busy;

  async function add() {
    if (!canAdd) return;
    setBusy(true);
    try {
      const r = await postDiary(gameId, text);
      setEntries(r.entries);
      setText('');
      onEntries?.(r.entries);
      onChanged?.();
    } catch (e) {
      toast({ kind: 'error', text: `Не удалось сохранить заметку. ${errorText(e)}` });
    } finally {
      setBusy(false);
    }
  }

  async function remove(entryId: number) {
    setBusy(true);
    try {
      const r = await deleteDiaryEntry(gameId, entryId);
      setEntries(r.entries);
      onEntries?.(r.entries);
      onChanged?.();
    } catch (e) {
      toast({ kind: 'error', text: `Не удалось удалить заметку. ${errorText(e)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ps-gd__sec ps-diary" aria-labelledby={id} data-testid="game-diary">
      <h3 id={id}>Дневник прохождения</h3>
      {entries.length === 0 && <p className="ps-diary__empty">Короткие заметки с датой — что запомнилось в этой игре.</p>}
      {entries.length > 0 && (
        <ul className="ps-diary__list">
          {entries.map((e) => (
            <li key={e.id} className="ps-diary__item" data-testid="diary-entry">
              <div className="ps-diary__tx">
                <time className="ps-diary__date" dateTime={e.createdAt}>{formatDayMonth(e.createdAt, true) ?? ''}</time>
                <p className="ps-diary__body">{e.body}</p>
              </div>
              <button type="button" className="ps-diary__del" data-testid="diary-delete" aria-label="Удалить заметку" disabled={busy} onClick={() => void remove(e.id)}>
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="ps-gd__rvlbl" htmlFor={`${id}-in`}>Новая заметка</label>
      <textarea
        id={`${id}-in`} className="ps-input ps-gd__rvnote" rows={3} value={text} placeholder="Что запомнилось сегодня…"
        aria-describedby={`${id}-cnt`} aria-invalid={tooLong || undefined}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="ps-gd__rvfoot">
        <button type="button" className="ps-btn ps-btn--primary ps-btn--sm" data-testid="diary-add" disabled={!canAdd} onClick={() => void add()}>Добавить</button>
        <span id={`${id}-cnt`} className="ps-gd__rvcnt num" data-over={tooLong || undefined}>{len}/{DIARY_NOTE_MAX}</span>
      </div>
    </section>
  );
}

/** Компактный список заметок в блоке истории игры. */
export function DiaryHistory({ entries }: { entries: DiaryEntry[] }) {
  if (!entries.length) return null;
  return (
    <div className="ps-diary-hist" data-testid="history-diary">
      <h4 className="ps-diary-hist__h">Заметки</h4>
      <ul className="ps-diary__list">
        {entries.map((e) => (
          <li key={e.id} className="ps-diary__item">
            <div className="ps-diary__tx">
              <time className="ps-diary__date" dateTime={e.createdAt}>{formatDayMonth(e.createdAt, true) ?? ''}</time>
              <p className="ps-diary__body">{e.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
