'use client';

import type { PsnProfile } from '@/server/collection/types';
import { Icon, PlatinumIcon } from '../icons';
import { formatNumber } from '../format';
import { Avatar } from '../primitives/Avatar';
import { levelBarPercent, levelProgressText, levelText, trophyCells, usableProfile } from './model';

/** Скелет блока профиля (design-system §4.16.1): круг 56, две строки, четыре счётчика. */
export function ProfileSkeleton() {
  return (
    <div className="ps-profile ps-profile--sk" aria-hidden="true">
      <span className="ps-skeleton ps-profile__sk-av" />
      <span className="ps-profile__sk-tx"><span className="ps-skeleton" /><span className="ps-skeleton" /></span>
      <span className="ps-profile__sk-tr">{[0, 1, 2, 3].map((i) => <span key={i} className="ps-skeleton" />)}</span>
    </div>
  );
}

/** Скелет профиля одной строкой (мобильный, §8.3): 100% x --profile-row-h, круг 36, линия 120x14, pill 56x20. */
export function ProfileRowSkeleton() {
  return (
    <div className="ps-profile ps-profile--row ps-profile--sk" aria-hidden="true">
      <span className="ps-skeleton ps-profile__sk-av" />
      <span className="ps-skeleton ps-profile__sk-nick" />
      <span className="ps-skeleton ps-profile__sk-pill" />
    </div>
  );
}

/**
 * Профиль одной строкой (мобильный, §8.3): аватар 36, ник, pill уровня, платина с числом; прогресс уровня полосой 3px по низу.
 * Золото, серебро, бронза и «Всего» не показываются (они в меню профиля). Нет уровня: pill и полоса скрыты; нет платин: счётчик скрыт.
 */
export function ProfileRow({ profile }: { profile: PsnProfile | null }) {
  const p = usableProfile(profile);
  if (!p) return null;
  const lvl = levelText(p);
  const next = levelProgressText(p);
  const bar = levelBarPercent(p);
  const plat = p.trophies && p.trophies.platinum > 0 ? p.trophies.platinum : null;
  return (
    <section className="ps-panel ps-profile ps-profile--row" aria-label={`Профиль PSN ${p.onlineId}`}>
      <Avatar url={p.avatarUrl} name={p.onlineId} size={36} />
      <p className="ps-profile__nick" title={p.onlineId}>{p.onlineId}</p>
      {lvl && <span className="ps-profile__pill num" title={next ?? undefined}>{lvl}</span>}
      {plat !== null && (
        <span className="ps-profile__plat" aria-label={`Платина ${formatNumber(plat)}`}>
          <PlatinumIcon size={16} /><b className="num">{formatNumber(plat)}</b>
        </span>
      )}
      {bar !== null && (
        <span className="ps-profile__rbar" role="progressbar" aria-label="Прогресс до следующего уровня" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bar}>
          <i style={{ width: `${bar}%` }} />
        </span>
      )}
    </section>
  );
}

/** Блок профиля PSN в шапке Коллекции. `tier` не показывается. */
export function ProfileCard({ profile }: { profile: PsnProfile | null }) {
  const p = usableProfile(profile);
  if (!p) return null;
  const lvl = levelText(p);
  const next = levelProgressText(p);
  const bar = levelBarPercent(p);
  const cells = trophyCells(p);
  return (
    <section className="ps-panel ps-profile" aria-label={`Профиль PSN ${p.onlineId}`}>
      <Avatar url={p.avatarUrl} name={p.onlineId} size={56} />
      <div className="ps-profile__main">
        <p className="ps-profile__nick" title={p.onlineId}>{p.onlineId}</p>
        {lvl && (
          <div className="ps-profile__lvl">
            <span className="ps-profile__pill num">{lvl}</span>
            {next && <span className="ps-profile__next num">{next}</span>}
          </div>
        )}
        {bar !== null && (
          <div className="ps-profile__bar" role="progressbar" aria-label="Прогресс до следующего уровня" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bar}>
            <i style={{ width: `${bar}%` }} />
          </div>
        )}
      </div>
      {cells && (
        <div className="ps-profile__tr" title="Трофеи аккаунта PSN">
          <ul className="ps-profile__cells">
            {cells.cells.map((c) => (
              <li key={c.kind} data-kind={c.kind} aria-label={c.aria}>
                {c.kind === 'platinum' ? <PlatinumIcon size={16} /> : <Icon name="trophy" size={16} />}
                <b className="num">{c.text}</b>
              </li>
            ))}
          </ul>
          <p className="ps-profile__total num">{cells.total}</p>
        </div>
      )}
    </section>
  );
}
