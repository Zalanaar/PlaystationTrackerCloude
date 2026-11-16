'use client';

// П8.3: «Поделиться» на финальном слайде Итогов года. Картинка 1080×1920 готовится заранее (GET /api/wrapped/share под сессией),
// чтобы Web Share на iOS вызвался прямо в нажатии (Safari требует жест пользователя). Нет Web Share с файлами — скачивание.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';

type State = { kind: 'loading' } | { kind: 'ready'; file: File } | { kind: 'error' };

export function shareFileName(year: number): string { return `itogi-${year}.png`; }

/** Один запрос на год за жизнь вкладки (повторный показ финала и StrictMode не качают картинку заново); сбой не кэшируется. */
const files = new Map<number, Promise<File>>();
function loadShareFile(year: number): Promise<File> {
  let p = files.get(year);
  if (!p) {
    p = fetch(`/api/wrapped/share?year=${year}`, { cache: 'no-store', credentials: 'same-origin' }).then(async (r) => {
      if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/png')) throw new Error(String(r.status));
      return new File([await r.blob()], shareFileName(year), { type: 'image/png' });
    });
    p.catch(() => files.delete(year));
    files.set(year, p);
  }
  return p;
}

export function ShareButton({ year }: { year: number }) {
  const [st, setSt] = useState<State>({ kind: 'loading' });
  const [note, setNote] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadShareFile(year).then((file) => { if (alive) setSt({ kind: 'ready', file }); }, () => { if (alive) setSt({ kind: 'error' }); });
    return () => { alive = false; };
  }, [year, attempt]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const onClick = async () => {
    if (st.kind === 'error') { setSt({ kind: 'loading' }); setNote(null); setAttempt((n) => n + 1); return; }
    if (st.kind !== 'ready') return;
    const data = { files: [st.file], title: `Итоги ${year}` };
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (typeof nav.share === 'function' && nav.canShare?.(data)) {
      try { await nav.share(data); return; } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return; // закрыл лист «Поделиться»
      }
    }
    // запасной путь: скачать файл (десктоп, браузеры без Web Share с файлами)
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(st.file);
    const a = document.createElement('a');
    a.href = urlRef.current;
    a.download = st.file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setNote('Картинка сохранена');
  };

  const label = st.kind === 'loading' ? 'Готовим картинку…' : st.kind === 'error' ? 'Повторить' : 'Поделиться';
  return (
    <>
      <button type="button" className="ps-btn ps-story__btn ps-story__btn--share" onClick={onClick} disabled={st.kind === 'loading'} aria-busy={st.kind === 'loading' || undefined} data-testid="story-share">
        <Icon name={st.kind === 'error' ? 'refresh' : 'share'} size={16} />{label}
      </button>
      <p className="ps-story__small ps-story__share-note" role="status" aria-live="polite">{st.kind === 'error' ? 'Не удалось подготовить картинку' : note ?? ''}</p>
    </>
  );
}
