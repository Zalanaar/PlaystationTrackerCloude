'use client';

// П15.5: чип активного тега и общий список тегов — отдельно от TagsSheet, чтобы ряд фильтров Коллекции не тянул сам sheet.
import { useEffect, useState } from 'react';
import type { TagDto } from '@/server/tags/tags';
import { Icon } from '../icons';
import { fetchTags, tagErrorText } from './api';
import { sortTags } from './model';

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

