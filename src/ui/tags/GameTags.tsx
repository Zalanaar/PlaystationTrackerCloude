'use client';

import { useEffect, useId, useState } from 'react';
import Link from '@/ui/IntentLink';
import type { TagDto } from '@/server/tags/tags';
import { Icon } from '../icons';
import { createTagApi, fetchGameTags, fetchTags, putGameTags, tagErrorText } from './api';
import { cleanName, nameValid, sortTags, tagHref, TAG_NAME_MAX } from './model';

/**
 * П13.2: блок «Теги» в окне игры. Чипы тегов ведут в коллекцию с фильтром; «Изменить» раскрывает переключатели всех тегов
 * и поле нового тега (создать и сразу повесить). Место под блок постоянное, пока теги грузятся.
 */
export function GameTags({ gameId }: { gameId: number }) {
  const hid = useId();
  const [all, setAll] = useState<TagDto[] | null>(null);
  const [mine, setMine] = useState<number[] | null>(null);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([fetchTags(ac.signal), fetchGameTags(gameId, ac.signal)]).then(
      ([t, g]) => { if (!ac.signal.aborted) { setAll(sortTags(t.items)); setMine(g.tagIds); } },
      (e) => { if (!ac.signal.aborted) { setAll([]); setMine([]); setError(tagErrorText(e)); } },
    );
    return () => ac.abort();
  }, [gameId]);

  async function save(next: number[]) {
    const prev = mine ?? [];
    setMine(next);
    setError(null);
    try {
      setMine((await putGameTags(gameId, next)).tagIds);
    } catch (e) {
      setMine(prev);
      setError(tagErrorText(e));
    }
  }
  const toggle = (id: number) => void save((mine ?? []).includes(id) ? (mine ?? []).filter((x) => x !== id) : [...(mine ?? []), id]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!nameValid(name) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { tag } = await createTagApi(cleanName(name));
      setAll((l) => sortTags([...(l ?? []), tag]));
      setName('');
      await save([...(mine ?? []), tag.id]);
    } catch (err) {
      setError(tagErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  const ready = all !== null && mine !== null;
  const chosen = ready ? all.filter((t) => mine.includes(t.id)) : [];
  return (
    <section className="ps-gd__sec ps-gtags" aria-labelledby={hid} data-testid="gd-tags">
      <h3 id={hid}>Теги</h3>
      {!ready ? (
        <div className="ps-skeleton ps-gtags__sk" aria-hidden="true" />
      ) : (
        <>
          <div className="ps-gtags__row">
            {chosen.map((t) => (
              <Link key={t.id} href={tagHref(t.id)} className="ps-chip ps-gtags__chip" data-testid="gd-tag">#{t.name}</Link>
            ))}
            {chosen.length === 0 && !edit && <span className="ps-gtags__none">Своих списков у игры нет</span>}
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-gtags__edit" aria-expanded={edit} onClick={() => setEdit((v) => !v)}>
              <Icon name={edit ? 'check' : 'pencil'} size={14} />{edit ? 'Готово' : chosen.length ? 'Изменить' : 'Добавить тег'}
            </button>
          </div>
          {edit && (
            <div className="ps-gtags__edit-box">
              {all.length > 0 && (
                <div className="ps-gtags__all" role="group" aria-label="Теги игры">
                  {all.map((t) => (
                    <button key={t.id} type="button" className="ps-chip ps-gtags__opt" aria-pressed={mine.includes(t.id)} onClick={() => toggle(t.id)}>
                      {mine.includes(t.id) && <Icon name="check" size={12} />}{t.name}
                    </button>
                  ))}
                </div>
              )}
              <form className="ps-gtags__new" onSubmit={add}>
                <input
                  className="ps-input" value={name} maxLength={TAG_NAME_MAX} placeholder="Новый тег, например «Перепройти»"
                  aria-label="Новый тег" onChange={(e) => setName(e.target.value)} enterKeyHint="done"
                />
                <button type="submit" className="ps-btn ps-btn--sm" disabled={!nameValid(name) || busy}>
                  <Icon name="plus" size={14} />Добавить
                </button>
              </form>
            </div>
          )}
        </>
      )}
      {error && <p className="ps-gtags__err" role="alert"><Icon name="circle-alert" size={14} />{error}</p>}
    </section>
  );
}
