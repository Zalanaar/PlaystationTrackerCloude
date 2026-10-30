import Link from 'next/link';
import type { ReactNode } from 'react';
import type { GameItem } from '@/server/collection/types';
import { formatNumber } from '../../format';
import { Icon, StatusGlyph } from '../../icons';
import { forgottenCountText } from '../../triage/forgotten';
import { isFull, type BlockId } from '../blocks';
import { BlockHead } from '../Chronicle';
import { previewSlots } from '../chronicle';
import { GameCard } from '../GameCard';
import { GameGrid, GameGridItem } from '../GameGrid';
import { SERVICE_ROWS, SERVICE_ROWS_STEP } from './pool';
import { renderChronicle } from './renderChronicle';
import { moreBtn, renderGames, renderPreview } from './renderGames';
import type { RenderCtx } from './renderCtx';

/** Блок «Игры-сервисы» (§4.3.1): один ряд + «Показать ещё {N}» / «Свернуть». */
export function renderService(c: RenderCtx, list: GameItem[]): ReactNode {
  const { view, density, cols, filters, actions, selectMode, selected, counts, serviceFull, serviceOpen, setServiceOpen, serviceRows, setServiceRows, rawLoaded } = c;
  const total = filters.platinum ? list.length : Math.max(counts.service, list.length);
  const isList = view === 'list';
  const card = (g: GameItem) => (
    <GameGridItem key={g.id}><GameCard game={g} actions={actions} selectMode={selectMode} selected={selected.has(g.id)} /></GameGridItem>
  );
  let body: ReactNode;
  let toggleBtn: ReactNode = null;
  if (isList) {
    const shown = serviceFull ? list : list.slice(0, serviceRows);
    body = renderGames(c, shown);
    if (!serviceFull) {
      const rest = total - shown.length;
      if (rest > 0) {
        toggleBtn = (
          <button type="button" className="ps-btn ps-btn--ghost" data-testid="service-toggle" onClick={() => setServiceRows((n) => n + SERVICE_ROWS_STEP)}>
            Показать ещё {formatNumber(rest)}
          </button>
        );
      } else if (list.length > SERVICE_ROWS) {
        toggleBtn = <button type="button" className="ps-btn ps-btn--ghost" data-testid="service-toggle" onClick={() => setServiceRows(SERVICE_ROWS)}>Свернуть</button>;
      }
    }
  } else {
    const expanded = serviceFull || serviceOpen;
    const rest = total - cols;
    body = (
      <>
        <GameGrid density={density}>{list.slice(0, cols).map(card)}</GameGrid>
        {list.length > cols && (
          <div className="ps-collapse" data-open={expanded || undefined} id="service-more">
            <div className="ps-collapse__in">
              <div className="ps-collapse__pad"><GameGrid density={density}>{list.slice(cols).map(card)}</GameGrid></div>
            </div>
          </div>
        )}
      </>
    );
    if (!serviceFull && rest > 0) {
      toggleBtn = (
        <button
          type="button" className="ps-btn ps-btn--ghost" data-testid="service-toggle" aria-expanded={serviceOpen} aria-controls="service-more"
          onClick={() => setServiceOpen((o) => !o)}
        >
          {serviceOpen ? 'Свернуть' : `Показать ещё ${formatNumber(rest)}`}
        </button>
      );
    }
  }
  return (
    <section key="service" className="ps-block" id="service" aria-labelledby="h-service">
      <BlockHead id="h-service" title="Игры-сервисы" count={total} icon={<StatusGlyph status="service" size={16} />} />
      {body}
      {toggleBtn && <div className="ps-more ps-more--service">{toggleBtn}</div>}
      {(serviceFull || (!isList && serviceOpen)) && moreBtn(c, 'service', counts.service - rawLoaded('service'))}
    </section>
  );
}

export function renderBlock(c: RenderCtx, b: BlockId): ReactNode {
  const { view, cols, filters, counts, byBlock, forgotten, setFilters, shownCount, rawLoaded } = c;
  const list = byBlock[b] ?? [];
  if (b === 'playing') return null; // лента рисуется отдельно
  if (b === 'chronicle') return list.length > 0 ? <div className="ps-block" key={b}>{renderChronicle(c)}</div> : null;
  if (b === 'service') return list.length > 0 ? renderService(c, list) : null;
  const full = isFull(b, filters.status, filters.platinum);
  const total = shownCount(counts[b === 'backlog' ? 'backlog' : b === 'shelved' ? 'shelved' : 'none'], list);
  if (list.length === 0) return null;
  const titles: Record<string, string> = { backlog: 'Бэклог', shelved: 'Отложено', unsorted: 'Не разобрано' };
  const id = b === 'unsorted' ? 'unsorted' : b;
  return (
    <section key={b} className="ps-block" id={id} aria-labelledby={`h-${id}`}>
      <BlockHead
        id={`h-${id}`} title={titles[b]} count={total}
        extra={b === 'unsorted' && (forgotten) > 0 ? (
          <Link href="/triage?forgotten=1" className="ps-chipbtn"><Icon name="clock" size={12} />{forgottenCountText(forgotten)}</Link>
        ) : undefined}
      >
        {b === 'backlog' && <Link href="/backlog" className="ps-link ps-link--plain">Все <Icon name="arrow-right" size={14} /></Link>}
        {b === 'unsorted' && <Link href="/triage" className="ps-btn ps-btn--primary">Разобрать по одной</Link>}
      </BlockHead>
      {full ? renderGames(c, list) : renderPreview(c, list, total, (
        b === 'backlog'
          ? <Link href="/backlog" className="ps-more-tile"><b className="num">+{formatNumber(previewSlots(total, view === 'list' ? 5 : cols).rest)}</b><span>ещё в бэклоге</span></Link>
          : <button type="button" className="ps-more-tile" onClick={() => setFilters({ status: 'none' })}><b className="num">+{formatNumber(previewSlots(total, view === 'list' ? 5 : cols).rest)}</b><span>ещё не разобрано</span></button>
      ))}
      {full && moreBtn(c, b, counts[b === 'backlog' ? 'backlog' : b === 'shelved' ? 'shelved' : 'none'] - rawLoaded(b))}
    </section>
  );
}
