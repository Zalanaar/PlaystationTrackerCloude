'use client';

import type { CollectionSummaryResponse, GameItem, GameStatusValue } from '@/server/collection/types';
import { cssUrl, formatDate, formatNumber, formatPlayTime, launchesText, relativeAgo } from '../format';
import { Icon, type IconName } from '../icons';
import { StatusChip, StatusMenu } from '../status';
import { Cover } from './Cover';
import type { StatusTab } from './filters';
import { dedupeContinue } from './filters';
import { dateMenuItem, type GameActions } from './GameCard';

function Tile({
  icon, value, label, active, onClick,
}: { icon: IconName; value: string; label: string; active?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <Icon name={icon} size={20} className="ps-tile__icon" />
      <span className="ps-tile__body">
        <span className="ps-tile__value ps-num">{value}</span>
        <span className="ps-micro">{label}</span>
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className="ps-tile" data-active={active || undefined} aria-pressed={active} onClick={onClick}>{body}</button>
  ) : (
    <div className="ps-tile">{body}</div>
  );
}

export function StatsHeader({
  summary, status, onStatus, heroUrl,
}: { summary: CollectionSummaryResponse | null; status: StatusTab; onStatus: (s: StatusTab) => void; heroUrl: string | null }) {
  const art = cssUrl(heroUrl);
  return (
    <section className="ps-stats" aria-label="Сводка" aria-busy={!summary} style={art ? ({ '--hero-art': art } as React.CSSProperties) : undefined}>
      <div className="ps-stats__profile">
        <span className="ps-avatar ps-avatar--lg" aria-hidden="true">А</span>
        <span>
          <span className="ps-stats__name">Артём</span>
          <span className="ps-stats__sub">Твоя коллекция</span>
        </span>
      </div>
      {summary ? (
        <div className="ps-stats__tiles">
          <Tile icon="gamepad" value={formatNumber(summary.totals.games)} label="Игр" active={status === 'all'} onClick={() => onStatus('all')} />
          <Tile icon="check-circle" value={formatNumber(summary.counts.completed)} label="Пройдено" active={status === 'completed'} onClick={() => onStatus('completed')} />
          <Tile icon="trophy" value={formatNumber(summary.totals.platinumEarned)} label="Платин" />
          <Tile icon="clock" value={formatNumber(summary.totals.hours)} label="Часов" />
        </div>
      ) : (
        <div className="ps-stats__tiles" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="ps-tile ps-skeleton" />)}
        </div>
      )}
    </section>
  );
}

export function NowPlaying({
  game, now, actions,
}: { game: GameItem; now: number; actions: GameActions }) {
  const time = formatPlayTime(game.playSeconds);
  return (
    <section className="ps-now" aria-label="Играю сейчас">
      <Cover url={game.coverUrl} title={game.title} className="ps-now__cover" />
      <div className="ps-now__body">
        <div className="ps-now__top">
          <span className="ps-now__label"><Icon name="play" size={12} />Играю сейчас</span>
          <span className="ps-badge-ps" title={game.platform}>PS</span>
          <span className="ps-now__actions">
            <button type="button" className="ps-btn ps-btn--ghost" onClick={() => actions.open(game)}>Открыть</button>
            <StatusMenu value={game.status} onPick={(s: GameStatusValue | null) => actions.setStatus(game, s)} label={`Статус: ${game.title}`} extra={dateMenuItem(game, actions)}>
              <StatusChip status={game.status} /><Icon name="chevron-down" size={14} />
            </StatusMenu>
          </span>
        </div>
        <h2 className="ps-now__title">{game.title}</h2>
        <p className="ps-now__year">{game.platform}</p>
        <div className="ps-now__chips">
          {time && <span className="ps-metachip"><Icon name="clock" size={14} />{time}</span>}
          {game.playCount > 0 && <span className="ps-metachip"><Icon name="play" size={14} />{launchesText(game.playCount)}</span>}
        </div>
        {game.lastPlayedAt && (
          <p className="ps-now__last">
            <Icon name="calendar" size={14} />
            <span>Последний запуск: <b>{formatDate(game.lastPlayedAt)}</b> · {relativeAgo(game.lastPlayedAt, now)}</span>
          </p>
        )}
      </div>
    </section>
  );
}

export function ContinueRow({
  summary, now, actions,
}: { summary: CollectionSummaryResponse; now: number; actions: GameActions }) {
  const list = dedupeContinue(summary.playing[0], summary.continue);
  if (!list.length) return null;
  return (
    <section aria-labelledby="continue-title" className="ps-section">
      <h2 id="continue-title" className="ps-h2 ps-h2--icon"><Icon name="play" size={18} className="ps-accent" />Продолжить</h2>
      <ul className="ps-continue">
        {list.map((g) => {
          const meta = [formatPlayTime(g.playSeconds), relativeAgo(g.lastPlayedAt, now)].filter(Boolean).join(' · ');
          return (
            <li key={g.id}>
              <button type="button" className="ps-ccard ps-card" onClick={() => actions.open(g)} aria-label={`Открыть: ${g.title}`}>
                <span className="ps-card__cover"><Cover url={g.coverUrl} title={g.title} /><span className="ps-badge-ps ps-ccard__ps">PS</span></span>
                <span className="ps-ccard__cap">
                  <span className="ps-ccard__title">{g.title}</span>
                  {meta && <span className="ps-ccard__meta">{meta}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
