'use client';

import { useEffect, useState } from 'react';
import Link from '@/ui/IntentLink';
import type { DayResponse } from '@/server/stats/day';
import { ApiError, errorText, fetchDay } from '../collection/api';
import { Cover, THUMB_W } from '../collection/Cover';
import { Icon } from '../icons';
import { TYPE_WORD } from '../trophies/model';
import { dateLong, formatMinutes } from './activity';
import { dayEmptyText, daySummary, trophyTypesLine } from './day';

type Loaded = { date: string; data: DayResponse } | { date: string; error: unknown };

/**
 * П11.1 «Дневник дня»: открывается тапом по дню карты «Активность». Игры дня (минуты по снимкам), трофеи и завершения,
 * ‹ › — соседние игровые дни (могут быть в другом году). Запрос отдельный и лёгкий.
 */
export function DayDiary({ date, onDate, onClose }: { date: string; onDate: (d: string) => void; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    fetchDay(date, ac.signal)
      .then((data) => { if (!ac.signal.aborted) setLoaded({ date, data }); })
      .catch((e: unknown) => {
        if (ac.signal.aborted || (e instanceof ApiError && e.status === 401)) return;
        setLoaded({ date, error: e });
      });
    return () => ac.abort();
  }, [date, attempt]);

  const fresh = loaded && loaded.date === date ? loaded : null;
  const d = fresh && 'data' in fresh ? fresh.data : null;
  const failed = fresh && 'error' in fresh ? fresh.error : null;
  // соседи из прошлого ответа, пока грузится новый: кнопки не прыгают
  const nav = d ?? (loaded && 'data' in loaded ? loaded.data : null);
  const summary = d ? daySummary(d) : '';
  const types = d ? trophyTypesLine(d) : '';

  return (
    <section className="ps-day" aria-labelledby="st-day-t" data-testid="day-diary" aria-busy={!d && !failed ? true : undefined}>
      <div className="ps-day__head">
        <button type="button" className="ps-iconbtn" aria-label="Предыдущий игровой день" disabled={!nav?.prev} onClick={() => nav?.prev && onDate(nav.prev)}><span aria-hidden="true">‹</span></button>
        <h4 className="ps-day__t" id="st-day-t" aria-live="polite">{dateLong(date)}</h4>
        <button type="button" className="ps-iconbtn" aria-label="Следующий игровой день" disabled={!nav?.next} onClick={() => nav?.next && onDate(nav.next)}><span aria-hidden="true">›</span></button>
        <button type="button" className="ps-iconbtn ps-day__x" aria-label="Закрыть дневник дня" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      {failed ? (
        <p className="ps-day__msg" role="alert">
          Не удалось загрузить день: {errorText(failed)}{' '}
          <button type="button" className="ps-btn ps-btn--sm" onClick={() => { setLoaded(null); setAttempt((a) => a + 1); }}>Повторить</button>
        </p>
      ) : !d ? (
        <div className="ps-day__sk" aria-hidden="true">{[0, 1].map((i) => <span key={i} className="ps-skeleton ps-day__sk-row" />)}</div>
      ) : (
        <>
          <p className="ps-day__sum" data-testid="day-summary">{summary || dayEmptyText(d)}</p>
          {d.games.length > 0 && (
            <ul className="ps-day__list" aria-label="Игры дня">
              {d.games.map((g) => (
                <li key={g.id} data-testid="day-game">
                  <Link href={`/?game=${g.id}`} className="ps-day__row">
                    <Cover url={g.coverUrl} title={g.title} className="ps-day__c" w={THUMB_W} />
                    <span className="ps-day__nm" title={g.title}>{g.title}</span>
                    <span className="ps-day__v num">{formatMinutes(g.minutes)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {d.finished.length > 0 && (
            <ul className="ps-day__list" aria-label="Завершены в этот день">
              {d.finished.map((f) => (
                <li key={f.id} data-testid="day-finished">
                  <Link href={`/?game=${f.id}`} className="ps-day__row">
                    <Cover url={f.coverUrl} title={f.title} className="ps-day__c" w={THUMB_W} />
                    <span className="ps-day__nm" title={f.title}>{f.title}</span>
                    <span className="ps-day__v" data-kind={f.kind}>{f.kind === 'completed' ? 'Пройдена' : 'Брошена'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {d.trophies.counts.total > 0 && (
            <div className="ps-day__tr">
              <p className="ps-day__trh">Трофеи: <span className="num">{d.trophies.counts.total}</span>{types ? ` · ${types}` : ''}</p>
              <ul className="ps-day__trl" aria-label="Трофеи дня">
                {d.trophies.items.map((t) => (
                  <li key={t.id} data-testid="day-trophy" data-type={t.type}>
                    <Icon name="trophy" size={14} />
                    <span className="ps-day__trn">{t.name ?? 'Трофей'}</span>
                    <span className="ps-day__trg">{t.game?.title ?? 'Игра вне коллекции'} · {TYPE_WORD[t.type]}</span>
                  </li>
                ))}
              </ul>
              {d.trophies.counts.total > d.trophies.items.length && (
                <p className="ps-day__more">И ещё {d.trophies.counts.total - d.trophies.items.length}. Все — в <Link href="/trophies?period=all">ленте трофеев</Link>.</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
