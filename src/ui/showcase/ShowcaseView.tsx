'use client';

// П14.3: публичная витрина (клиент). Данные — GET /api/showcase/<ключ>; закрытая или неверная ссылка — «Витрина закрыта».
// Ничего личного, кроме ника и общих цифр; обложки без Referer (ключ в адресе не уходит на CDN).
import { useEffect, useState } from 'react';
import type { Showcase } from '@/server/showcase/showcase';
import { formatHours } from '../format';

type Load = { kind: 'loading' } | { kind: 'closed' } | { kind: 'error' } | { kind: 'ready'; d: Showcase };

const num = (n: number) => n.toLocaleString('ru-RU');
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const monthText = (ym: string | null) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '');
const STAT_KEYS: [keyof Showcase['values'], string][] = [
  ['games', 'Игр'], ['completed', 'Пройдено'], ['hours', 'Часов'], ['trophies', 'Трофеев'], ['platinum', 'Платин'], ['achievements', 'Достижений из 12'],
];

function Cover({ url, name }: { url: string | null; name: string }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element -- обложки с CDN PSN, без оптимизатора Next (публичная страница, no-referrer)
    ? <img className="ps-sc__cover" src={url} alt="" width={48} height={48} loading="lazy" referrerPolicy="no-referrer" />
    : <span className="ps-sc__cover ps-sc__cover--empty" aria-hidden="true">{name.slice(0, 1)}</span>;
}

export function ShowcaseView({ token }: { token: string }) {
  const [s, setS] = useState<Load>({ kind: 'loading' });
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/showcase/${encodeURIComponent(token)}`, { cache: 'no-store', signal: ac.signal, referrerPolicy: 'no-referrer' })
      .then(async (r) => {
        if (r.status === 404) return setS({ kind: 'closed' });
        const b = await r.json().catch(() => null);
        if (!r.ok || !b?.ok) return setS({ kind: 'error' });
        setS({ kind: 'ready', d: b.data as Showcase });
      })
      .catch(() => { if (!ac.signal.aborted) setS({ kind: 'error' }); });
    return () => ac.abort();
  }, [token]);

  // Заголовок с ником. Next дописывает метаданные потоком уже после гидратации (в WebKit — позже нашего ответа),
  // поэтому держим свой заголовок, пока страница открыта.
  const nick = s.kind === 'ready' ? s.d.onlineId : null;
  useEffect(() => {
    if (!nick) return;
    const title = `Витрина ${nick} · PS Tracker`;
    const apply = () => { if (document.title !== title) document.title = title; };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [nick]);

  if (s.kind === 'closed' || s.kind === 'error') {
    return (
      <main className="ps-sc" data-testid="showcase-off">
        <h1 className="ps-sc__h1">{s.kind === 'closed' ? 'Витрина закрыта' : 'Витрина временно недоступна'}</h1>
        <p className="ps-sc__lead">{s.kind === 'closed' ? 'Ссылка устарела или владелец закрыл витрину.' : 'Попробуйте открыть ссылку позже.'}</p>
      </main>
    );
  }
  const d = s.kind === 'ready' ? s.d : null;
  return (
    <main className="ps-sc" data-testid="showcase" aria-busy={!d || undefined}>
      <header className="ps-sc__head">
        {d?.avatarUrl
          // eslint-disable-next-line @next/next/no-img-element -- аватар PSN с CDN
          ? <img className="ps-sc__ava" src={d.avatarUrl} alt="" width={64} height={64} referrerPolicy="no-referrer" />
          : <span className="ps-sc__ava ps-sc__cover--empty" aria-hidden="true">{d ? (d.onlineId ?? '?').slice(0, 1) : ''}</span>}
        <div>
          <h1 className="ps-sc__h1">{d ? (d.onlineId ?? 'Игрок PlayStation') : 'Витрина'}</h1>
          <p className="ps-sc__lead">{d?.trophyLevel ? `Уровень трофеев ${d.trophyLevel} · ` : ''}витрина PS Tracker</p>
        </div>
      </header>
      <dl className="ps-sc__stats">
        {STAT_KEYS.map(([k, label]) => <div key={k} className="ps-sc__stat"><dt>{label}</dt><dd className="num">{d ? num(d.values[k]) : '…'}</dd></div>)}
      </dl>
      {d && d.top.length > 0 && (
        <section aria-labelledby="sc-top">
          <h2 id="sc-top" className="ps-sc__h2">Больше всего часов</h2>
          <ul className="ps-sc__list">
            {d.top.map((g, i) => <li key={i} className="ps-sc__item" data-testid="sc-top"><Cover url={g.imageUrl} name={g.name} /><span className="ps-sc__name">{g.name}</span><span className="ps-sc__meta num">{formatHours(g.hours)}</span></li>)}
          </ul>
        </section>
      )}
      {d && d.done.length > 0 && (
        <section aria-labelledby="sc-done">
          <h2 id="sc-done" className="ps-sc__h2">Недавно пройдено</h2>
          <ul className="ps-sc__list">
            {d.done.map((g, i) => <li key={i} className="ps-sc__item" data-testid="sc-done"><Cover url={g.imageUrl} name={g.name} /><span className="ps-sc__name">{g.name}</span><span className="ps-sc__meta">{monthText(g.month)}</span></li>)}
          </ul>
        </section>
      )}
      <p className="ps-sc__foot">Неофициальный трекер. PlayStation — товарный знак Sony Interactive Entertainment.</p>
    </main>
  );
}
