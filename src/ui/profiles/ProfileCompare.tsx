'use client';

// П14.1 «Сравнение профилей»: два профиля своего входа рядом — ключевые цифры (больше — жирным, без опоры на цвет)
// и общие игры с часами и статусом у каждого. Таблица постоянной формы: пока грузится — «…» в ячейках, без сдвига.
import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { fetchCompare, type CompareData, type CompareMetricId, type Profile } from './api';

const METRICS: { id: CompareMetricId; label: string }[] = [
  { id: 'games', label: 'Игр в коллекции' },
  { id: 'completed', label: 'Пройдено' },
  { id: 'hours', label: 'Часов в играх' },
  { id: 'trophies', label: 'Трофеев' },
  { id: 'platinum', label: 'Платин' },
  { id: 'ultra_rare', label: 'Ультраредких' },
  { id: 'achievements', label: 'Достижений из 12' },
];
const STATUS: Record<string, string> = { playing: 'играю', completed: 'пройдена', dropped: 'брошена', backlog: 'в бэклоге', shelved: 'отложена', service: 'сервис' };
const num = (n: number) => n.toLocaleString('ru-RU');
const nickOf = (p: Pick<Profile, 'onlineId'>) => p.onlineId ?? 'Без ника';
const hoursText = (h: number) => (h > 0 ? `${h.toLocaleString('ru-RU')} ч` : 'не играл');
const sideText = (s: { hours: number; status: string | null }) => [hoursText(s.hours), s.status ? STATUS[s.status] : null].filter(Boolean).join(' · ');

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: CompareData };

export function ProfileCompare({ profiles, activeId }: { profiles: Profile[]; activeId: number }) {
  const first = profiles.find((p) => p.id === activeId) ?? profiles[0];
  const [a, setA] = useState(first.id);
  const [b, setB] = useState((profiles.find((p) => p.id !== first.id) ?? profiles[1]).id);
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setState({ kind: 'loading' });
    fetchCompare(a, b, ac.signal).then(
      (data) => setState({ kind: 'ready', data }),
      () => { if (!ac.signal.aborted) setState({ kind: 'error' }); },
    );
    return () => ac.abort();
  }, [a, b, retry]);

  // выбор того же профиля во втором списке — меняем местами
  const pickA = (id: number) => { if (id === b) setB(a); setA(id); };
  const pickB = (id: number) => { if (id === a) setA(b); setB(id); };
  const pa = profiles.find((p) => p.id === a) ?? first;
  const pb = profiles.find((p) => p.id === b) ?? profiles[1];
  const d = state.kind === 'ready' ? state.data : null;

  const select = (label: string, value: number, on: (id: number) => void, testid: string) => (
    <label className="ps-pcmp__pick">
      <span>{label}</span>
      <span className="ps-pcmp__sel">
        <select value={value} onChange={(e) => on(Number(e.target.value))} data-testid={testid}>
          {profiles.map((p) => <option key={p.id} value={p.id}>{nickOf(p)}</option>)}
        </select>
        <Icon name="chevron-down" size={16} />
      </span>
    </label>
  );

  return (
    <section className="ps-panel ps-pcmp" aria-labelledby="ps-pcmp-h" data-testid="pcmp">
      <h2 id="ps-pcmp-h" className="ps-h3">Сравнение профилей</h2>
      <div className="ps-pcmp__picks">
        {select('Первый', a, pickA, 'pcmp-a')}
        {select('Второй', b, pickB, 'pcmp-b')}
      </div>
      {state.kind === 'error' ? (
        <p className="ps-pcmp__err" role="alert">
          Не удалось сравнить профили.{' '}
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => setRetry((n) => n + 1)}>Повторить</button>
        </p>
      ) : (
        <>
          <table className="ps-pcmp__t" aria-busy={state.kind === 'loading' || undefined}>
            <caption className="ps-pcmp__cap">Цифры профилей {nickOf(pa)} и {nickOf(pb)}</caption>
            <thead>
              <tr><th scope="col"><span className="ps-pcmp__vh">Показатель</span></th><th scope="col" title={nickOf(pa)}>{nickOf(pa)}</th><th scope="col" title={nickOf(pb)}>{nickOf(pb)}</th></tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const va = d?.a.values[m.id];
                const vb = d?.b.values[m.id];
                return (
                  <tr key={m.id} data-metric={m.id}>
                    <th scope="row">{m.label}</th>
                    <td className="num" data-lead={(va !== undefined && vb !== undefined && va > vb) || undefined}>{va === undefined ? '…' : num(va)}</td>
                    <td className="num" data-lead={(va !== undefined && vb !== undefined && vb > va) || undefined}>{vb === undefined ? '…' : num(vb)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="ps-pcmp__note">Больше — жирным. Часы и пройденные — без скрытых игр и дублей.</p>
          {d && (
            <div className="ps-pcmp__common">
              <h3 className="ps-pcmp__h">Общие игры <span className="num">{num(d.common.count)}</span></h3>
              {d.common.count === 0 ? (
                <p className="ps-pcmp__note">Общих игр пока нет.</p>
              ) : (
                <ul className="ps-pcmp__list" aria-label="Общие игры">
                  {d.common.items.map((g, i) => (
                    <li key={`${g.name}-${i}`} className="ps-pcmp__game" data-testid="pcmp-game">
                      <b title={g.name}>{g.name}</b>
                      <span><span className="ps-pcmp__who">{nickOf(d.a)}:</span> {sideText(g.a)}</span>
                      <span><span className="ps-pcmp__who">{nickOf(d.b)}:</span> {sideText(g.b)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {d.common.count > d.common.items.length && <p className="ps-pcmp__note">Показаны {d.common.items.length} с наибольшим числом часов.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
