'use client';

import { useId } from 'react';
import { Cover } from '../collection/Cover';
import { formatHours } from '../collection/backlog';
import { NotPurchasedBadge } from '../collection/NotPurchasedBadge';
import { matchGameMeta, type ManualMatch } from './match';
import { Icon } from '../icons';

export type MatchBusy = 'yes' | 'no' | null;

/** Карточка «Это та игра?» (design-system §19.6): слева запись «не куплено», справа игра библиотеки, ответы «Да, она» / «Нет». */
export function MatchCard({
  match, busy, error, onAnswer,
}: { match: ManualMatch; busy: MatchBusy; error: boolean; onAnswer: (a: 'yes' | 'no') => void }) {
  const hid = useId();
  const pair = `${match.title} и ${match.game.name}`;
  return (
    <li className="ps-match" data-testid="match-card" aria-labelledby={hid} aria-busy={busy !== null || undefined} data-busy={busy !== null || undefined}>
      <h3 id={hid} className="ps-match__h">Это та игра?</h3>
      <div className="ps-match__sides">
        <div className="ps-match__side">
          <span className="ps-match__cap">Ты добавил</span>
          <div className="ps-match__game">
            <Cover url={match.coverUrl} title={match.title} className="ps-match__cover" />
            <div className="ps-match__text">
              <span className="ps-match__title" title={match.title}>{match.title}</span>
              {match.kind === 'other_platform'
                ? <span className="ps-plat-tag" data-testid="match-platform">{match.platformLabel ?? 'Другая платформа'}</span>
                : match.notPurchased && <NotPurchasedBadge />}
            </div>
          </div>
        </div>
        <span className="ps-match__sep" aria-hidden="true">
          <Icon name="arrow-left-right" size={16} className="ps-match__sep-h" />
          <Icon name="arrow-down" size={16} className="ps-match__sep-v" />
        </span>
        <div className="ps-match__side">
          <span className="ps-match__cap">В библиотеке</span>
          <div className="ps-match__game">
            <Cover url={match.game.imageUrl} title={match.game.name} className="ps-match__cover" />
            <div className="ps-match__text">
              <span className="ps-match__title" title={match.game.name}>{match.game.name}</span>
              <span className="ps-match__meta">{matchGameMeta(match.game, formatHours)}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="ps-match__btns">
        <button
          type="button" className="ps-btn ps-btn--primary" data-testid="match-yes" disabled={busy !== null} aria-label={`Да, это та же игра: ${pair}`}
          onClick={() => onAnswer('yes')}
        >
          {busy === 'yes' ? <><Icon name="loader" size={14} className="ps-nb-spin" />Подтверждаю…</> : <><Icon name="check" size={16} />Да, она</>}
        </button>
        <button
          type="button" className="ps-btn ps-btn--ghost" data-testid="match-no" disabled={busy !== null} aria-label={`Нет, это разные игры: ${pair}`}
          onClick={() => onAnswer('no')}
        >
          {busy === 'no' ? <><Icon name="loader" size={14} className="ps-nb-spin" />Сохраняю…</> : <><Icon name="x" size={16} />Нет</>}
        </button>
      </div>
      {error && <p className="ps-match__err" role="alert"><Icon name="circle-alert" size={14} />Не удалось сохранить. Повтори.</p>}
      <p className="ps-match__hint">
        {match.kind === 'other_platform'
          ? '«Да»: игра куплена на PlayStation, запись с другой платформы скроется. «Нет» оставит её в блоке «Игры с других платформ», эту пару мы больше не предложим.'
          : '«Да» снимет пометку «Не куплено» и свяжет записи. «Нет» оставит игру в бэклоге, эту пару мы больше не предложим.'}
      </p>
    </li>
  );
}
