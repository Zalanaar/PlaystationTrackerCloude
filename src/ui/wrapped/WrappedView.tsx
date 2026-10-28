'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WrappedResponse } from '@/server/wrapped/types';
import './wrapped.css';
import { ApiError, errorText, fetchWrapped } from '../collection/api';
import { EmptyState } from '../EmptyState';
import { Icon } from '../icons';
import { parseYearParam } from './model';
import { WrappedStory } from './WrappedStory';

type Loaded = { key: string; data: WrappedResponse } | { key: string; error: unknown };

export function WrappedView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlYear = parseYearParam(params.get('year'));
  const key = String(urlYear ?? 'current');

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [years, setYears] = useState<WrappedResponse['years']>([]);
  const [open, setOpen] = useState(false);
  const reqId = useRef(0);

  const load = useCallback(async (y: number | null, k: string) => {
    const id = ++reqId.current;
    try {
      const data = await fetchWrapped(y);
      if (id !== reqId.current) return;
      setYears(data.years);
      setLoaded({ key: k, data });
    } catch (e) {
      if (id !== reqId.current) return;
      if (e instanceof ApiError && e.status === 401) return;
      setLoaded({ key: k, error: e });
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(urlYear, key), 0);
    return () => clearTimeout(t);
  }, [load, urlYear, key]);

  const fresh = loaded && loaded.key === key ? loaded : null;
  const data = fresh && 'data' in fresh ? fresh.data : null;
  const failed = fresh && 'error' in fresh ? fresh.error : null;
  const selected = urlYear ?? (loaded && 'data' in loaded ? loaded.data.year : null);

  const pick = (y: number) => router.replace(`${pathname}?year=${y}`, { scroll: false });

  return (
    <div className="ps-wrapped-page">
      <div className="ps-pagehead">
        <h1 className="ps-h1">Итоги</h1>
      </div>
      <p className="ps-wrapped-lead">Год в играх: часы, любимые игры, пройденное, трофеи и жанры. Выбери год и смотри историю.</p>

      {failed ? (
        <EmptyState icon="circle-alert" role="alert" title="Что-то пошло не так" text={`Не удалось загрузить итоги. ${errorText(failed)}`}>
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => void load(urlYear, key)}>Повторить</button>
        </EmptyState>
      ) : (
        <>
          <section aria-label="Выбор года">
            <h2 className="ps-h2 ps-wrapped-h">Год</h2>
            {years.length === 0 ? (
              <div className="ps-wrapped-years" aria-busy="true" data-testid="years-skeleton">
                {[0, 1, 2].map((i) => <div key={i} className="ps-skeleton ps-wrapped-year" />)}
              </div>
            ) : (
              <div className="ps-wrapped-years" role="group" aria-label="Год">
                {years.map((y) => (
                  <button
                    key={y.year} type="button" className="ps-wrapped-year" aria-pressed={selected === y.year}
                    data-nodata={!y.hasData || undefined} onClick={() => pick(y.year)}
                  >
                    <span className="ps-wrapped-year__y ps-num">{y.year}</span>
                    {!y.hasData && <span className="ps-wrapped-year__n">нет данных</span>}
                  </button>
                ))}
              </div>
            )}
          </section>
          <div>
            <button
              type="button" className="ps-btn ps-btn--primary ps-wrapped-go" disabled={!data} aria-busy={!data || undefined}
              onClick={() => setOpen(true)}
            >
              <Icon name="play" size={16} />
              Смотреть итоги
            </button>
          </div>
        </>
      )}
      {open && data && <WrappedStory data={data} onClose={() => { setOpen(false); }} />}
    </div>
  );
}
