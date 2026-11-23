'use client';
// «Оценки» — раздел Статистики. Данные — вся коллекция из /api/games (страницами по 300), считается на клиенте.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameItem } from '@/server/collection/types';
import { EmptyState } from '../EmptyState';
import { fetchGames } from '../collection/api';
import { formatNumber, plural } from '../format';
import { average, avgText, bandHoursText, completedUnrated, distribution, hoursByBand, isRated, topGenres, type Rated } from './model';

const PAGE = 300;
const UNRATED_SHOWN = 12;

async function loadAll(): Promise<GameItem[]> {
  const out: GameItem[] = [];
  for (let offset = 0; offset < 5000; offset += PAGE) {
    const r = await fetchGames(new URLSearchParams({ limit: String(PAGE), offset: String(offset), sort: 'title' }));
    out.push(...r.items);
    if (out.length >= r.total || r.items.length < PAGE) break;
  }
  return out;
}

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; games: GameItem[] };
const gamesWord = (n: number) => plural(n, ['игра', 'игры', 'игр']);

export function RatingsView() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const fetchAll = useCallback(() => loadAll().then((games) => setLoad({ kind: 'ok', games }), () => setLoad({ kind: 'error' })), []);
  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const games = useMemo(() => (load.kind === 'ok' ? load.games : []), [load]);
  const rated = useMemo(() => games.filter(isRated) as Rated[], [games]);
  const dist = useMemo(() => distribution(rated), [rated]);
  const max = Math.max(1, ...dist);
  const avg = average(rated);
  const bands = useMemo(() => hoursByBand(rated), [rated]);
  const genres = useMemo(() => topGenres(rated), [rated]);
  const unrated = useMemo(() => completedUnrated(games), [games]);

  return (
    <section className="ps-ratings" id="ratings" data-testid="ratings" aria-labelledby="st-ratings">
      <h2 id="st-ratings" className="ps-h2">Оценки</h2>
      {load.kind === 'loading' && <div className="ps-ratings__ph" aria-busy="true" aria-label="Загружаю оценки" />}
      {load.kind === 'error' && (
        <EmptyState icon="circle-alert" role="alert" title="Не удалось загрузить оценки" text="Проверь связь и попробуй ещё раз.">
          <button type="button" className="ps-btn" onClick={() => { setLoad({ kind: 'loading' }); void fetchAll(); }}>Повторить</button>
        </EmptyState>
      )}
      {load.kind === 'ok' && rated.length === 0 && (
        <EmptyState icon="sparkles" role="status" title="Оценок пока нет" text="Поставь оценку в окне игры или сразу после «Пройдено» — здесь появится распределение и лучшие жанры." />
      )}

      {load.kind === 'ok' && rated.length > 0 && (
        <>
          <p className="ps-ratings__lead num" data-testid="ratings-summary">
            Оценено {formatNumber(rated.length)} {gamesWord(rated.length)} · средняя {avg !== null ? avgText(avg) : '—'}
          </p>

          <section className="ps-ratings__sec" aria-labelledby="rt-dist">
            <h2 id="rt-dist">Распределение</h2>
            <ol className="ps-ratings__dist" data-testid="ratings-dist">
              {dist.map((n, score) => (
                <li key={score} aria-label={`${score}: ${formatNumber(n)} ${gamesWord(n)}`}>
                  <span className="ps-ratings__bar" style={{ height: `${Math.round((n / max) * 100)}%` }} data-empty={n === 0 || undefined} aria-hidden="true" />
                  <span className="ps-ratings__n num" aria-hidden="true">{n || ''}</span>
                  <span className="ps-ratings__s num" aria-hidden="true">{score}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="ps-ratings__sec" aria-labelledby="rt-hours">
            <h2 id="rt-hours">Оценка и часы</h2>
            <table className="ps-ratings__table" data-testid="ratings-hours">
              <thead><tr><th scope="col">Оценка</th><th scope="col">Игр</th><th scope="col">Обычно наиграно</th></tr></thead>
              <tbody>
                {bands.map((b) => (
                  <tr key={b.label}><th scope="row" className="num">{b.label}</th><td className="num">{formatNumber(b.count)}</td><td className="num">{bandHoursText(b)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="ps-ratings__note">Медиана наигранного по играм с этой оценкой.</p>
          </section>

          {genres.length > 0 && (
            <section className="ps-ratings__sec" aria-labelledby="rt-genres">
              <h2 id="rt-genres">Лучшие жанры</h2>
              <ol className="ps-ratings__list" data-testid="ratings-genres">
                {genres.map((x) => (
                  <li key={x.key}><span>{x.label}</span><span className="num">{avgText(x.avg)} · {formatNumber(x.count)} {gamesWord(x.count)}</span></li>
                ))}
              </ol>
              <p className="ps-ratings__note">Средняя оценка, жанры с двумя оценками и больше.</p>
            </section>
          )}
        </>
      )}

      {load.kind === 'ok' && unrated.length > 0 && (
        <section className="ps-ratings__sec" aria-labelledby="rt-unrated">
          <h2 id="rt-unrated">Пройдено без оценки · {formatNumber(unrated.length)}</h2>
          <ul className="ps-ratings__list" data-testid="ratings-unrated">
            {unrated.slice(0, UNRATED_SHOWN).map((g) => (
              <li key={g.id}><span>{g.title}</span><Link href={`/?game=${g.id}`} className="ps-btn ps-btn--ghost">Оценить</Link></li>
            ))}
          </ul>
          {unrated.length > UNRATED_SHOWN && <p className="ps-ratings__note">Ещё {formatNumber(unrated.length - UNRATED_SHOWN)} — в Коллекции, фильтр «Пройдено».</p>}
        </section>
      )}
    </section>
  );
}
