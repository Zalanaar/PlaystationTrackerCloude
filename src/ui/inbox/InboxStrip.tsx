'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '../icons';
import { useIsMobile } from '../primitives/hooks';
import type { Chip } from './model';
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

type BoxState = 'loading' | 'empty' | 'error' | 'gone' | 'hidden';

/**
 * Место под полосу, пока чипов нет (п. B). Скелет занимает место сразу; если чипов так и не будет (пустой ответ, ошибка,
 * сводка недоступна), коробка остаётся той же высоты и показывает строку состояния поверх невидимого скелета.
 * Так нет сдвига вёрстки: раньше пустой ответ схлопывал скелет анимацией высоты (CLS ~0.04 при медленном ответе).
 */
function ReservedBox({ state, ctl, onHide }: { state: BoxState; ctl: InboxCtl; onHide: () => void }) {
  const loading = state === 'loading';
  const sk = loading ? 'ps-skeleton ' : '';
  return (
    <section
      className="ps-inbox ps-inbox--sk" data-state={state} aria-busy={loading ? 'true' : undefined}
      aria-label={loading ? 'Загрузка сводки' : 'С прошлого визита'} data-testid={loading ? 'inbox-skeleton' : 'inbox-reserved'}
    >
      {/* после загрузки те же размеры, но без класса ps-skeleton: страница не должна выглядеть «ещё грузится» */}
      <span className={`${sk}ps-inbox__sk-label`} aria-hidden="true" />
      <span className="ps-inbox__sk-row" aria-hidden="true">
        <span className={`${sk}ps-inbox__sk-chip`} /><span className={`${sk}ps-inbox__sk-chip`} /><span className={`${sk}ps-inbox__sk-chip`} />
      </span>
      {state === 'empty' && (
        <div className="ps-inbox__note" role="status" data-testid="inbox-empty">
          <span className="ps-micro ps-inbox__label">С прошлого визита</span>
          <span className="ps-inbox__note-txt">ничего нового</span>
          {!ctl.hidden && (
            <button type="button" className="ps-iconbtn ps-inbox__x" aria-label="Скрыть на сегодня" data-testid="inbox-hide" onClick={onHide}>
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
      )}
      {state === 'hidden' && (
        <div className="ps-inbox__note" role="status" data-testid="inbox-hidden-note">
          <span className="ps-micro ps-inbox__label">С прошлого визита</span>
          <span className="ps-inbox__note-txt">скрыто до конца дня</span>
        </div>
      )}
      {state === 'error' && (
        <p className="ps-inbox__note ps-inbox--err" role="status" data-testid="inbox-error">
          <Icon name="circle-alert" size={14} />
          <span>Сводку загрузить не удалось</span>
          <button type="button" className="ps-link" data-testid="inbox-retry" onClick={ctl.retry}>Повторить</button>
        </p>
      )}
      {state === 'gone' && (
        <p className="ps-inbox__note ps-inbox--err" role="status" data-testid="inbox-gone">
          <Icon name="circle-alert" size={14} />
          <span>Сводка сейчас недоступна</span>
        </p>
      )}
    </section>
  );
}

/** Полоса «С прошлого визита» над «Играю» (спека A). Пустая и скрытая не рендерится, если место под неё ещё не было занято. */
export function InboxStrip({ ctl }: { ctl: InboxCtl }) {
  const mobile = useIsMobile();
  const [matchOpen, setMatchOpen] = useState(false);
  // Скелет уже занял место: дальше без чипов держим ту же коробку, а не убираем её (иначе сдвиг вёрстки)
  const [reserved, setReserved] = useState(false);
  // ✕ нажат здесь: убрать полосу целиком (сдвиг по действию пользователя допустим). Скрытие, узнанное позже из localStorage, держит место.
  const [userHid, setUserHid] = useState(false);
  const hide = () => { setUserHid(true); ctl.hide(); };
  const skeleton = ctl.enabled && ctl.phase === 'loading' && !ctl.hidden && !ctl.quiet;
  if (skeleton && !reserved) setReserved(true);
  if (!ctl.enabled) return null;
  const hasChips = ctl.phase === 'ready' && ctl.chips.length > 0;
  // «Скрыть на сегодня»: полоса остаётся только ради чипа «Это та игра?» (Фаза 43); скрытие — действие пользователя, сдвиг допустим
  if (ctl.hidden && !hasChips) return reserved && !userHid ? <ReservedBox state="hidden" ctl={ctl} onHide={hide} /> : null;

  // прошлый ответ был пустым (клиентский переход без памяти): место не занимаем, пока не придут чипы
  if (ctl.quiet && !reserved && !hasChips) return null;
  if (ctl.phase === 'loading') return <ReservedBox state="loading" ctl={ctl} onHide={hide} />;
  if (!hasChips) {
    const state: BoxState = ctl.phase === 'error' ? 'error' : ctl.phase === 'gone' ? 'gone' : 'empty';
    if (reserved || skeleton) return <ReservedBox state={state} ctl={ctl} onHide={hide} />;
    if (state === 'error') {
      return (
        <p className="ps-inbox--err" role="status" data-testid="inbox-error">
          <Icon name="circle-alert" size={14} />
          <span>Сводку загрузить не удалось</span>
          <button type="button" className="ps-link" data-testid="inbox-retry" onClick={ctl.retry}>Повторить</button>
        </p>
      );
    }
    return null;
  }

  return (
    <section className="ps-inbox" aria-labelledby="inbox-h" data-testid="inbox-strip" data-count={ctl.chips.length}>
      <div className="ps-inbox__row">
        <h2 id="inbox-h" className="ps-micro ps-inbox__label">С прошлого визита</h2>
        {!ctl.hidden && (
          <button type="button" className="ps-iconbtn ps-inbox__x" aria-label="Скрыть на сегодня" data-testid="inbox-hide" onClick={hide}>
            <Icon name="x" size={16} />
          </button>
        )}
        <ul className="ps-inbox__list" aria-label={`Список из ${ctl.chips.length}`}>
          {/* D-P1: на телефоне все чипы одной прокручиваемой строкой (без «Ещё N») */}
          {ctl.chips.map((c) => <li key={c.id}><ChipLink c={c} mobile={mobile} onOpen={() => setMatchOpen(true)} /></li>)}
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
