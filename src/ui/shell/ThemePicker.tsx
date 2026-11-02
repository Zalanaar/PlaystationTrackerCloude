'use client';

import { useSyncExternalStore } from 'react';
import { Icon } from '../icons';
import { Popover } from '../primitives/Popover';
import { applyTheme, themeFromAttr } from '../theme';
import { syncThemeMeta } from '../theme-meta';
import { THEMES, type ThemeId } from '../tokens';

const EVENT = 'ps-theme-change';

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const theme = useSyncExternalStore(
    subscribe,
    () => themeFromAttr(document.documentElement.getAttribute('data-theme')),
    () => 'night' as ThemeId,
  );
  const set = (id: ThemeId) => {
    applyTheme(id, {
      root: document.documentElement,
      storage: (() => { try { return localStorage; } catch { return null; } })(),
      setCookie: (c) => { document.cookie = c; },
    });
    // theme-color браузера = --bg новой темы (§8.5)
    syncThemeMeta(document as never, id);
    window.dispatchEvent(new Event(EVENT));
  };
  return [theme, set];
}

/** Кружок-превью: переменные темы подхватываются через data-theme на самом элементе. */
function Swatch({ attr }: { attr: string | null }) {
  return (
    <span className="ps-swatch" data-theme={attr ?? 'night'} aria-hidden="true">
      <span className="ps-swatch__dot" />
    </span>
  );
}

export function ThemeList({ onPick }: { onPick?: () => void }) {
  const [theme, setTheme] = useTheme();
  return (
    <>
      {THEMES.map((t) => (
        <button
          key={t.id} type="button" role="menuitemradio" aria-checked={theme === t.id} className="ps-menu-item"
          onClick={() => { setTheme(t.id); onPick?.(); }}
        >
          <Swatch attr={t.attr} />
          <span className="ps-menu-item__label">{t.label}</span>
          {theme === t.id && <Icon name="check" size={16} />}
        </button>
      ))}
    </>
  );
}

export function ThemePicker() {
  const [theme] = useTheme();
  const cur = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  return (
    <Popover
      align="end"
      trigger={(p) => (
        <button type="button" className="ps-btn ps-btn--theme" data-tour="theme" aria-label={`Тема: ${cur.label}`} {...p}>
          <Swatch attr={cur.attr} />
          <span>{cur.label}</span>
          <Icon name="chevron-down" size={14} />
        </button>
      )}
    >
      {(close) => <ThemeList onPick={close} />}
    </Popover>
  );
}
