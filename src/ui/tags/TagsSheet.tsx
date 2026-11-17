'use client';

import { useEffect, useState } from 'react';
import type { TagDto } from '@/server/tags/tags';
import { Icon } from '../icons';
import { Sheet } from '../primitives/Sheet';
import { createTagApi, deleteTagApi, fetchTags, renameTagApi, tagErrorText } from './api';
import { cleanName, gamesCount, nameValid, sortTags, TAG_NAME_MAX } from './model';

/** Список тегов (общий кэш GET). `version` — перечитать после правки. */
export function useTagList(enabled: boolean, version = 0): { tags: TagDto[] | null; error: string | null } {
  const [state, setState] = useState<{ tags: TagDto[] | null; error: string | null }>({ tags: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    fetchTags(ac.signal).then(
      (r) => { if (!ac.signal.aborted) setState({ tags: sortTags(r.items), error: null }); },
      (e) => { if (!ac.signal.aborted) setState({ tags: [], error: tagErrorText(e) }); },
    );
    return () => ac.abort();
  }, [enabled, version]);
  return state;
}

/** Активный фильтр тега в ряду чипов: «#Название ×» снимает фильтр. Ширина ограничена: длинное имя обрезается. */
export function TagFilterChip({ tagId, onClear }: { tagId: number; onClear: () => void }) {
  const { tags } = useTagList(true);
  const name = tags ? tags.find((t) => t.id === tagId)?.name ?? 'тег удалён' : '…';
  return (
    <button
      type="button" className="ps-filterchip ps-chip ps-filterchip--platx ps-filterchip--tag" data-wide="" aria-pressed="true" data-testid="tag-chip"
      aria-label={`Тег ${name}: показать все игры`} onClick={onClear}
    >
      <span className="ps-filterchip__t">#{name}</span><Icon name="x" size={14} />
    </button>
  );
}

type Row = { mode: 'view' } | { mode: 'rename'; text: string } | { mode: 'delete' };

/**
 * П13.2: «Теги» — свои списки игр. Нажатие на тег показывает коллекцию с этим тегом (плоским списком),
 * здесь же создать, переименовать и удалить тег. Повесить тег на игру — в окне игры.
 */
export function TagsSheet({ open, onClose, activeTag, onPick }: {
  open: boolean; onClose: () => void; activeTag: number | null; onPick: (tag: number | null) => void;
}) {
  const [version, setVersion] = useState(0);
  const { tags, error: loadError } = useTagList(open, version);
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const row = (id: number): Row => rows[id] ?? { mode: 'view' };
  const setRow = (id: number, r: Row) => setRows((m) => ({ ...m, [id]: r }));

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(tagErrorText(e)); } finally { setBusy(false); }
  }

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameValid(name)) return;
    void run(async () => {
      await createTagApi(cleanName(name));
      setName('');
      setVersion((v) => v + 1);
    });
  };
  const rename = (t: TagDto, text: string) => run(async () => {
    await renameTagApi(t.id, cleanName(text));
    setRow(t.id, { mode: 'view' });
    setVersion((v) => v + 1);
  });
  const remove = (t: TagDto) => run(async () => {
    await deleteTagApi(t.id);
    setVersion((v) => v + 1);
    if (activeTag === t.id) onPick(null);
  });

  return (
    <Sheet open={open} onClose={onClose} title="Теги" className="ps-tags">
      <div className="ps-stack">
        <p className="ps-tags__lead">Свои списки игр: «Кооп», «Перепройти», «Для отпуска». Повесить тег на игру — в окне игры.</p>
        {!tags ? (
          <div className="ps-skeleton ps-tags__sk" aria-hidden="true" />
        ) : tags.length === 0 ? (
          <p className="ps-tags__empty">Тегов пока нет. Создай первый ниже.</p>
        ) : (
          <ul className="ps-tags__list" aria-label="Мои теги">
            {tags.map((t) => {
              const r = row(t.id);
              return (
                <li key={t.id} className="ps-tags__row" data-testid="tag-row">
                  {r.mode === 'rename' ? (
                    <form className="ps-tags__form" onSubmit={(e) => { e.preventDefault(); if (nameValid(r.text)) void rename(t, r.text); }}>
                      <input
                        className="ps-input" value={r.text} maxLength={TAG_NAME_MAX} aria-label={`Новое название тега ${t.name}`} autoFocus
                        onChange={(e) => setRow(t.id, { mode: 'rename', text: e.target.value })} enterKeyHint="done"
                      />
                      <button type="submit" className="ps-btn ps-btn--sm" disabled={busy || !nameValid(r.text)}>Сохранить</button>
                      <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => setRow(t.id, { mode: 'view' })}>Отмена</button>
                    </form>
                  ) : r.mode === 'delete' ? (
                    <div className="ps-tags__confirm" role="group" aria-label={`Удалить тег ${t.name}`}>
                      <span className="ps-tags__q">Удалить «{t.name}»? Тег снимется с игр, сами игры останутся.</span>
                      <button type="button" className="ps-btn ps-btn--danger ps-btn--sm" disabled={busy} onClick={() => void remove(t)}>Удалить</button>
                      <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => setRow(t.id, { mode: 'view' })}>Отмена</button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button" className="ps-tags__pick" aria-pressed={activeTag === t.id}
                        onClick={() => { onPick(activeTag === t.id ? null : t.id); onClose(); }}
                      >
                        <span className="ps-tags__name">#{t.name}</span>
                        <span className="ps-tags__n num">{gamesCount(t.count)}</span>
                      </button>
                      <button type="button" className="ps-btn ps-btn--icon" aria-label={`Переименовать тег ${t.name}`} onClick={() => setRow(t.id, { mode: 'rename', text: t.name })}>
                        <Icon name="pencil" size={16} />
                      </button>
                      <button type="button" className="ps-btn ps-btn--icon" aria-label={`Удалить тег ${t.name}`} onClick={() => setRow(t.id, { mode: 'delete' })}>
                        <Icon name="trash" size={16} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <form className="ps-tags__form" onSubmit={add}>
          <input
            className="ps-input" value={name} maxLength={TAG_NAME_MAX} placeholder="Новый тег" aria-label="Новый тег"
            onChange={(e) => setName(e.target.value)} enterKeyHint="done"
          />
          <button type="submit" className="ps-btn ps-btn--sm" disabled={busy || !nameValid(name)}><Icon name="plus" size={14} />Добавить</button>
        </form>
        {(error ?? loadError) && <p className="ps-tags__err" role="alert"><Icon name="circle-alert" size={14} />{error ?? loadError}</p>}
        {activeTag !== null && (
          <button type="button" className="ps-link" onClick={() => { onPick(null); onClose(); }}>Показать все игры</button>
        )}
        <button type="button" className="ps-btn ps-btn--primary" onClick={onClose}>Готово</button>
      </div>
    </Sheet>
  );
}
