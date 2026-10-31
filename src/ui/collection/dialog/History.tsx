import type { GameHistory } from '@/server/collection/types';
import { PlatinumIcon } from '../../icons';
import { historyLine, historyView } from '../history';

/** «История игры» на «Обзоре» (спека design-system 12): часы по неделям МСК, оценка штриховкой, отметки трофеев. */
export function History({ history, lastPlayedAt, now }: { history: GameHistory | null | undefined; lastPlayedAt: string | null; now: number }) {
  const v = historyView(history);
  if (!v) return null;
  const line = historyLine(history, lastPlayedAt, now);
  const lineHint = history?.hasHours ? 'По ежедневным снимкам: дни до первого синка неизвестны.' : null;
  return (
    <section className="ps-gd__sec ps-gd__hist" aria-labelledby="gd-hist" data-testid="game-history">
      <h3 id="gd-hist">История игры</h3>
      {line && (
        <p className="ps-gd__histline" title={lineHint ?? undefined} data-testid="history-line">
          {line.played && <>Играл <b className="num">{line.played}</b></>}
          {line.played && line.last && ', последний раз '}
          {!line.played && line.last && 'Последний раз '}
          {line.last}
        </p>
      )}
      {line?.played && lineHint && <p className="ps-gd__histsub">{lineHint}</p>}
      <div className="ps-gd__chart" role="img" aria-label={v.summary} data-hours={v.showHours || undefined}>
        <ol className="ps-gd__bars" data-dense={v.bars.length > 26 || undefined} aria-hidden="true">
          {v.bars.map((b) => (
            <li key={b.weekStart} title={b.title} data-sync={b.syncStart || undefined}>
              <span className="ps-gd__wk">
                {b.totalPct > 0 && (
                  <span className="ps-gd__stack" style={{ height: `${b.totalPct}%` }}>
                    {b.estSec > 0 && <i className="ps-gd__est" data-testid="history-est" style={{ flexGrow: b.estSec }} />}
                    {b.realSec > 0 && <i className="ps-gd__real" style={{ flexGrow: b.realSec }} />}
                  </span>
                )}
              </span>
              <span className="ps-gd__mark" data-mark={b.mark ?? undefined}>
                {b.mark === 'platinum' && <PlatinumIcon size={14} />}
              </span>
            </li>
          ))}
        </ol>
        <div className="ps-gd__axis" aria-hidden="true">
          <span>{v.axisStart}</span>
          <span>{v.axisEnd}</span>
        </div>
      </div>
      <ul className="ps-gd__legend" aria-label="Обозначения графика">
        {v.showHours && <li><i className="ps-gd__sw" />часы по снимкам</li>}
        {v.showHours && v.hasEstimate && <li><i className="ps-gd__sw ps-gd__sw--est" /><b>оценка</b> до первого синка</li>}
        {v.hasPlatinum && <li><PlatinumIcon size={12} />платина</li>}
        {v.hasTrophies && <li><i className="ps-gd__dot" />трофеи</li>}
        {v.syncLabel && <li><i className="ps-gd__sw ps-gd__sw--sync" />первый синк, {v.syncLabel}</li>}
      </ul>
      {v.truncated && <p className="ps-gd__note">Показаны последние 52 недели.</p>}
      {!v.showHours && (
        <p className="ps-gd__note">{history?.hasHours ? 'Часов за эти недели нет, только трофеи.' : 'Часы по неделям появятся после первого синка. Здесь только трофеи.'}</p>
      )}
    </section>
  );
}
