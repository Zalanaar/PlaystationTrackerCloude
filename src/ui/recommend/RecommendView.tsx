'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import '../recommend.css';
import { BacklogMode } from './BacklogMode';
import { candidatesText, recommendHref, parseTime } from './model';

/** Экран «Подскажи» (/recommend): подсказки из бэклога. Лишние параметры адреса (`mode`) убираются при открытии. */
export function RecommendView() {
  const router = useRouter();
  const params = useSearchParams();
  const [candidates, setCandidates] = useState<number | null>(null);

  useEffect(() => {
    if (params.get('mode') === null) return;
    router.replace(recommendHref(parseTime(params.get('time'))), { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- нормализация адреса только при открытии страницы
  }, []);

  return (
    <div className="ps-rec-page">
      <div className="ps-pagehead ps-rec-head">
        <h1 className="ps-h1">Подскажи</h1>
        {candidates !== null && <p className="ps-rec-sub">{candidatesText(candidates)}</p>}
      </div>
      <BacklogMode active onCandidates={setCandidates} onTime={() => {}} />
    </div>
  );
}
