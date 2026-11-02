'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { useIsMobile } from '../primitives/hooks';
import { splitMobile, type Chip } from './model';
import type { InboxCtl } from './useInbox';
import { MatchSheet } from './MatchSheet';

function ChipLink({ c, mobile, onOpen }: { c: Chip; mobile: boolean; onOpen?: () => void }) {
  const segs = mobile ? c.mobile : c.desktop;
  const body = (
    <>
      <Icon name={c.icon} size={16} className={c.platinum ? 'ps-inbox__plat' : undefined} />
      <span className="ps-inbox__txt">{segs.map((s, i) => (s.num ? <b key={i} className="num">{s.t}</b> : <span key={i}>{s.t}</span>))}</span>
      {c.action && <Icon name="chevron-right" size={14} className="ps-inbox__chev" />}
    </>
  );
  if (c.opensSheet) {
    return (
      <button type="button" className="ps-chipbtn ps-inbox__chip" data-testid={c.testid} aria-label={c.aria} aria-haspopup="dialog" onClick={onOpen}>
        {body}
      </button>
    );
  }
  return (
    <Link
      href={c.href} className="ps-chipbtn ps-inbox__chip" data-testid={c.testid} data-window={c.window} data-platinum={c.platinum || undefined} aria-label={c.aria}
    >
      {body}
    </Link>
  );
}

/** Полоса «С прошлого визита» над «Играю» (спека A). Пустая и скрытая не рендерится. */
export function InboxStrip({ ctl }: { ctl: InboxCtl }) {
  const mobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  // Пустой ответ после скелета: скелет плавно схлопывается по высоте (без скачка вёрстки), потом снимается
  const [prevPhase, setPrevPhase] = useState(ctl.phase);
  const [collapse, setCollapse] = useState<'no' | 'run' | 'done'>('no');
  const empty = (ctl.phase === 'ready' && ctl.chips.length === 0) || ctl.phase === 'gone';
  if (prevPhase !== ctl.phase) {
    setPrevPhase(ctl.phase);
    if (prevPhase === 'loading' && empty) setCollapse('run');
  }
  useEffect(() => {
    if (collapse !== 'run') return;
    const ms = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260;
    const t = setTimeout(() => setCollapse('done'), ms);
    return () => clearTimeout(t);
  }, [collapse]);
  if (!ctl.enabled) return null;
  // «Скрыть на сегодня»: полоса остаётся только ради чипа «Это та игра?» (Фаза 43)
  if (ctl.hidden && (ctl.phase !== 'ready' || ctl.chips.length === 0)) return null;

  if (ctl.phase === 'loading' || collapse === 'run') {
    return (
      <div className="ps-inbox-wrap" data-collapsed={collapse === 'run' ? 'true' : undefined}>
        <div className="ps-inbox-wrap__in">
          <section className="ps-inbox ps-inbox--sk" aria-busy="true" aria-label="Загрузка сводки" data-testid="inbox-skeleton">
            <span className="ps-skeleton ps-inbox__sk-label" />
            <span className="ps-inbox__sk-row">
              <span className="ps-skeleton ps-inbox__sk-chip" /><span className="ps-skeleton ps-inbox__sk-chip" /><span className="ps-skeleton ps-inbox__sk-chip" />
            </span>
          </section>
        </div>
      </div>
    );
  }
  if (ctl.phase === 'error') {
    return (
      <p className="ps-inbox--err" role="status" data-testid="inbox-error">
        <Icon name="circle-alert" size={14} />
        <span>Сводку загрузить не удалось</span>
        <button type="button" className="ps-link" data-testid="inbox-retry" onClick={ctl.retry}>Повторить</button>
      </p>
    );
  }
  if (ctl.phase !== 'ready' || ctl.chips.length === 0) return null;

  const { visible, hidden } = mobile ? splitMobile(ctl.chips, expanded) : { visible: ctl.chips, hidden: [] };
  const extra = mobile && (hidden.length > 0 || expanded) ? ctl.chips.length - splitMobile(ctl.chips, false).visible.length : 0;
  return (
    <section className="ps-inbox" aria-labelledby="inbox-h" data-testid="inbox-strip" data-count={ctl.chips.length}>
      <div className="ps-inbox__row">
        <h2 id="inbox-h" className="ps-micro ps-inbox__label">С прошлого визита</h2>
        {!ctl.hidden && (
          <button type="button" className="ps-iconbtn ps-inbox__x" aria-label="Скрыть на сегодня" data-testid="inbox-hide" onClick={ctl.hide}>
            <Icon name="x" size={16} />
          </button>
        )}
        <ul className="ps-inbox__list" aria-label={`Список из ${ctl.chips.length}`}>
          {visible.map((c) => <li key={c.id}><ChipLink c={c} mobile={mobile} onOpen={() => setMatchOpen(true)} /></li>)}
          {extra > 0 && (
            <li>
              <button type="button" className="ps-chipbtn ps-inbox__chip ps-inbox__more" aria-expanded={expanded} data-testid="inbox-more" onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Свернуть' : `Ещё ${extra}`}
              </button>
            </li>
          )}
        </ul>
      </div>
      {matchOpen && (
        <MatchSheet
          onClose={() => setMatchOpen(false)} onRemaining={ctl.setMatchCount}
          onChanged={() => { /* Коллекция подхватит связанную игру при следующей загрузке */ }}
        />
      )}
    </section>
  );
}
