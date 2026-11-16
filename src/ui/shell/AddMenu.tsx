'use client';

import { useRouter } from 'next/navigation';
import { Icon } from '../icons';
import { Popover } from '../primitives/Popover';
import { addItemsFor, emitHeaderAction } from './headerActions';

/** П9: «+» мобильной шапки — короткий выбор, что добавить. Своё для страницы первым; окно открывает сама страница (событие или ?add=). */
export function AddMenu({ pathname }: { pathname: string }) {
  const router = useRouter();
  const items = addItemsFor(pathname);
  return (
    <Popover
      align="end" className="ps-mobile-only ps-addmenu"
      trigger={(p) => (
        <button type="button" className="ps-iconbtn" data-testid="hdr-add" aria-label="Добавить" {...p}>
          <Icon name="plus" size={22} />
        </button>
      )}
    >
      {(close) => items.map((it) => (
        <button
          key={it.id} type="button" role="menuitem" className="ps-menu-item ps-addmenu__item" data-testid={`add-${it.id}`}
          onClick={() => {
            close();
            // окно вернёт фокус на то, что было в фокусе до него: на «+», а не на исчезнувший пункт меню
            document.querySelector<HTMLElement>('[data-testid="hdr-add"]')?.focus();
            if (it.action) emitHeaderAction(it.action);
            else router.push(it.href);
          }}
        >
          <Icon name={it.icon} size={18} />
          <span className="ps-addmenu__tx">
            <span className="ps-menu-item__label">{it.label}</span>
            <small>{it.hint}</small>
          </span>
        </button>
      ))}
    </Popover>
  );
}
