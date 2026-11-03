import { Icon, PlatinumIcon } from '../../icons';
import type { PlatinumForecast } from '@/server/collection/types';
import { APPROX_NOTE, APPROX_TITLE, forecastView } from '../forecast';

/** «Путь к платине» (спека п.8.1): прогресс, остаток по грейдам, редкость, DLC. Приблизительность по `approximate`. */
export function PlatinumPath({ f }: { f: PlatinumForecast }) {
  const v = forecastView(f);
  const approx = v.approximate;
  return (
    <section className="ps-gd__sec ps-gd__fc" aria-labelledby="gd-fc-t" data-almost={v.almost || undefined}>
      <div className="ps-gd__fch">
        <PlatinumIcon size={20} className="ps-gd__fcicon" />
        <h3 id="gd-fc-t">Путь к платине</h3>
        <span className="ps-gd__fcpct num" aria-label={v.pctAria}>
          {approx && <span className="ps-approx" title={APPROX_TITLE} aria-hidden="true">≈ </span>}{v.pct}
        </span>
      </div>
      <div className="ps-gd__prog" role="progressbar" aria-label="Прогресс к платине" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.progress}>
        <i style={{ width: `${v.progress}%` }} />
      </div>
      <p className="ps-gd__fcs">{v.requiredText}</p>
      <div className="ps-gd__rem">
        <div>
          <span className="ps-gd__lbl">Осталось</span>
          <b className="ps-gd__remv">{v.remainingText}</b>
        </div>
        {v.grades.length > 0 && (
          <ul className="ps-gd__grades" aria-label="Осталось по типам">
            {v.grades.map((g) => (
              <li key={g.type} data-type={g.type} aria-label={g.label} title={g.label}><Icon name="trophy" size={14} /><span className="num">{g.count}</span></li>
            ))}
          </ul>
        )}
        {v.hiddenText && <span className="ps-gd__hid"><Icon name="eye-off" size={12} />{v.hiddenText}</span>}
        {v.almost && <span className="ps-gd__almost">Почти готово</span>}
      </div>
      <dl className="ps-gd__metrics">
        {v.metrics.map((m) => (
          <div key={m.id}>
            <dt>{m.label}</dt>
            <dd className="num" data-empty={m.empty || undefined}>
              {m.value}
              {m.segments !== null && (
                <span className="ps-rar__seg" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} data-on={i < (m.segments ?? 0) || undefined} />)}</span>
              )}
            </dd>
            <dd className="ps-gd__msub">{m.sub || '\u00a0'}</dd>
          </div>
        ))}
      </dl>
      {v.ratesNote && <p className="ps-gd__note">{v.ratesNote}</p>}
      {v.dlcText && <p className="ps-gd__note ps-gd__dlc">{v.dlcText}</p>}
      {approx && <p className="ps-gd__note ps-gd__approx"><Icon name="info" size={12} />{APPROX_NOTE}</p>}
    </section>
  );
}
