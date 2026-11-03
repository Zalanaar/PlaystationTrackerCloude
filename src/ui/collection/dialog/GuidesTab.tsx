'use client';

import { useId, useState } from 'react';
import type { GameGuide, GameItem } from '@/server/collection/types';
import { Icon } from '../../icons';
import { ApiError, errorText, putGuide } from '../api';
import { guideLinks, guideQuery, guideSite } from '../guides';

type Phase = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; text: string };

function ExtLink({ href, name, site, id }: { href: string; name: string; site: string; id: string }) {
  return (
    <a className="ps-gd__glink" href={href} target="_blank" rel="noopener noreferrer" data-guide={id}>
      <span className="ps-gd__gname">{name}</span>
      <span className="ps-gd__gsite">{site}</span>
      <Icon name="external-link" size={16} />
    </a>
  );
}

/**
 * Вкладка «Гайды» (F2-A + F2-B): своя ссылка владельца → точный гайд PowerPyx из недельного индекса (с названием гайда,
 * чтобы было видно ремейк/оригинал) и «Не тот гайд» → ссылки-поиск PowerPyx и PSNProfiles (всегда). Без запросов к сайтам с сервера.
 */
export function GuidesTab({ game, guide: initial }: { game: Pick<GameItem, 'id' | 'title'>; guide?: GameGuide | null }) {
  const [guide, setGuide] = useState<GameGuide | null>(initial ?? null);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(initial?.override ?? '');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const inputId = useId();
  const errId = useId();
  const links = guideLinks(game.title);
  const busy = phase.kind === 'saving';

  async function save(body: { override?: string | null; dismissed?: boolean }) {
    setPhase({ kind: 'saving' });
    try {
      const r = await putGuide(game.id, body);
      setGuide(r.guide);
      setUrl(r.guide.override ?? '');
      setEditing(false);
      setPhase({ kind: 'idle' });
    } catch (e) {
      setPhase({ kind: 'error', text: e instanceof ApiError && e.status === 400 ? 'Нужна ссылка https:// (до 500 символов).' : `Не сохранено. ${errorText(e)}` });
    }
  }

  return (
    <section className="ps-gd__sec ps-gd__guides" aria-labelledby="gd-guides">
      <h3 id="gd-guides">Гайды по трофеям</h3>
      {guide?.override ? (
        <div className="ps-gd__gmain" data-testid="guide-own">
          <ExtLink href={guide.override} name="Мой гайд" site={guideSite(guide.override)} id="own" />
        </div>
      ) : guide?.match ? (
        <div className="ps-gd__gmain" data-testid="guide-match">
          <ExtLink href={guide.match.url} name={`PowerPyx: ${guide.match.title}`} site="powerpyx.com · гайд и роадмап" id="match" />
          {guide.match.wikiUrl && <ExtLink href={guide.match.wikiUrl} name={`Wiki: ${guide.match.title}`} site="powerpyx.com · прохождение" id="wiki" />}
        </div>
      ) : null}

      {guide && !editing && (
        <div className="ps-gd__gactions">
          {guide.override ? (
            <>
              <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={() => { setEditing(true); setPhase({ kind: 'idle' }); }}>Изменить ссылку</button>
              <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={() => save({ override: null })}>Убрать свою ссылку</button>
            </>
          ) : (
            <>
              {guide.match && <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} data-testid="guide-wrong" onClick={() => save({ dismissed: true })}>Не тот гайд</button>}
              <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} data-testid="guide-own-add" onClick={() => { setEditing(true); setPhase({ kind: 'idle' }); }}>Указать свою ссылку</button>
            </>
          )}
          {guide.dismissed && !guide.override && (
            <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} data-testid="guide-restore" onClick={() => save({ dismissed: false })}>Вернуть найденный гайд</button>
          )}
        </div>
      )}

      {editing && (
        <form className="ps-gd__gform" onSubmit={(e) => { e.preventDefault(); void save({ override: url.trim() === '' ? null : url.trim() }); }}>
          <label htmlFor={inputId} className="ps-gd__glabel">Ссылка на гайд</label>
          <input
            id={inputId} className="ps-input" type="url" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="https://…"
            value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} aria-invalid={phase.kind === 'error' || undefined} aria-describedby={phase.kind === 'error' ? errId : undefined}
            autoFocus
          />
          <div className="ps-gd__gactions">
            <button type="submit" className="ps-btn ps-btn--primary" disabled={busy}>Сохранить</button>
            <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={() => { setEditing(false); setUrl(guide?.override ?? ''); setPhase({ kind: 'idle' }); }}>Отмена</button>
          </div>
        </form>
      )}
      {phase.kind === 'error' && <p id={errId} className="ps-gd__gerr" role="alert">{phase.text}</p>}

      <p className="ps-gd__note">
        {guide?.override || guide?.match ? 'Ещё поиск' : 'Поиск'} по названию «{guideQuery(game.title)}». Гайды на английском, откроются на сайте.
      </p>
      <ul className="ps-gd__glist">
        {links.map((l) => (
          <li key={l.id}><ExtLink href={l.href} name={`${l.label}: найти гайд`} site={l.site} id={l.id} /></li>
        ))}
      </ul>
    </section>
  );
}
