'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '../icons';
import { useIsMobile } from '../primitives/hooks';
import { splitMobile, type Chip } from './model';
import type { InboxCtl } from './useInbox';

function ChipLink({ c, mobile }: { c: Chip; mobile: boolean }) {
  const segs = mobile ? c.mobile : c.desktop;
  return (
    <Link
      href={c.href} className="ps-chipbtn ps-inbox__chip" data-testid={c.testid} data-window={c.window} data-platinum={c.platinum || undefined} aria-label={c.aria}
    >
      <Icon name={c.icon} size={16} className={c.platinum ? 'ps-inbox__plat' : undefined} />
      <span className="ps-inbox__txt">{segs.map((s, i) => (s.num ? <b key={i} className="num">{s.t}</b> : <span key={i}>{s.t}</span>))}</span>
      {c.action && <Icon name="chevron-right" size={14} className="ps-inbox__chev" />}
    </Link>
  );
}

/** Полоса «С прошлого визита» над «Играю» (спека A). Пустая и скрытая не рендерится. */
export function InboxStrip({ ctl }: { ctl: InboxCtl }) {
  const mobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  if (!ctl.enabled || ctl.hidden) return null;

  if (ctl.phase === 'loading') {
    return (
      <section className="ps-inbox ps-inbox--sk" aria-busy="true" aria-label="Загрузка сводки" data-testid="inbox-skeleton">
        <span className="ps-skeleton ps-inbox__sk-label" />
        <span className="ps-inbox__sk-row">
          <span className="ps-skeleton ps-inbox__sk-chip" /><span className="ps-skeleton ps-inbox__sk-chip" /><span className="ps-skeleton ps-inbox__sk-chip" />
        </span>
      </section>
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
        <button type="button" className="ps-iconbtn ps-inbox__x" aria-label="Скрыть на сегодня" data-testid="inbox-hide" onClick={ctl.hide}>
          <Icon name="x" size={16} />
        </button>
        <ul className="ps-inbox__list" aria-label={`Список из ${ctl.chips.length}`}>
          {visible.map((c) => <li key={c.id}><ChipLink c={c} mobile={mobile} /></li>)}
          {extra > 0 && (
            <li>
              <button type="button" className="ps-chipbtn ps-inbox__chip ps-inbox__more" aria-expanded={expanded} data-testid="inbox-more" onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Свернуть' : `Ещё ${extra}`}
              </button>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
