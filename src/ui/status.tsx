'use client';

import type { GameStatusValue } from '@/server/collection/types';
import { Icon } from './icons';
import { StatusIcon } from './icons';
import { Popover } from './primitives/Popover';
import { useIsMobile } from './primitives/hooks';
import { Sheet } from './primitives/Sheet';
import { STATUS_META, type StatusKey } from './tokens';
import { useState } from 'react';

export const STATUS_ORDER: readonly StatusKey[] = ['playing', 'completed', 'backlog', 'dropped', 'shelved', 'none'];

export const toKey = (s: GameStatusValue | null): StatusKey => s ?? 'none';
export const fromKey = (k: StatusKey): GameStatusValue | null => (k === 'none' ? null : k);

/** Чип статуса (§3). iconOnly: 24x24 с aria-label. */
export function StatusChip({ status, iconOnly }: { status: GameStatusValue | null; iconOnly?: boolean }) {
  const key = toKey(status);
  const meta = STATUS_META[key];
  if (iconOnly) {
    return (
      <span className="ps-chip ps-chip--icon" data-status={key} role="img" aria-label={meta.label} title={meta.label}>
        <StatusIcon status={key} size={16} />
      </span>
    );
  }
  return (
    <span className="ps-chip" data-status={key}>
      <StatusIcon status={key} size={16} />
      {meta.label}
    </span>
  );
}

function Items({ value, onPick, extra }: { value?: GameStatusValue | null; onPick: (s: GameStatusValue | null) => void; extra?: React.ReactNode }) {
  return (
    <>
      {STATUS_ORDER.map((k) => (
        <button
          key={k} type="button" role="menuitemradio" aria-checked={value !== undefined && toKey(value) === k} className="ps-menu-item ps-menu-item--tall"
          onClick={() => onPick(fromKey(k))}
        >
          <StatusIcon status={k} />
          <span className="ps-menu-item__label">{STATUS_META[k].label}</span>
          {value !== undefined && toKey(value) === k && <Icon name="check" size={16} />}
        </button>
      ))}
      {extra}
    </>
  );
}

/**
 * Выбор статуса: на десктопе выпадающее меню, на мобильном bottom sheet.
 * `children` рисует кнопку-триггер.
 */
export function StatusMenu({
  value, onPick, label, extra, children, className, align, triggerClassName,
}: {
  align?: 'start' | 'end';
  triggerClassName?: string;
  value?: GameStatusValue | null;
  onPick: (s: GameStatusValue | null) => void;
  label: string;
  /** Доп. пункты (например «Изменить дату»); получают close */
  extra?: (close: () => void) => React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  if (mobile) {
    return (
      <>
        <button type="button" className={`ps-trigger ${className ?? ''} ${triggerClassName ?? ''}`} aria-label={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {children}
        </button>
        <Sheet open={open} onClose={() => setOpen(false)} title="Статус">
          <div role="menu" className="ps-list">
            <Items value={value} onPick={(s) => { setOpen(false); onPick(s); }} extra={extra?.(() => setOpen(false))} />
          </div>
        </Sheet>
      </>
    );
  }
  return (
    <Popover
      className={className} align={align}
      trigger={(p) => (
        <button type="button" className={`ps-trigger ${triggerClassName ?? ''}`} aria-label={label} {...p}>{children}</button>
      )}
    >
      {(close) => <Items value={value} onPick={(s) => { close(); onPick(s); }} extra={extra?.(close)} />}
    </Popover>
  );
}

/** Управляемый bottom sheet выбора статуса (долгий тап по карточке на мобильном). */
export function StatusSheet({
  open, onClose, title, value, onPick, extra,
}: {
  open: boolean; onClose: () => void; title: string; value: GameStatusValue | null;
  onPick: (s: GameStatusValue | null) => void; extra?: (close: () => void) => React.ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Статус">
      <p className="ps-sheet__sub">{title}</p>
      <div role="menu" className="ps-list">
        <Items value={value} onPick={(s) => { onClose(); onPick(s); }} extra={extra?.(onClose)} />
      </div>
    </Sheet>
  );
}
