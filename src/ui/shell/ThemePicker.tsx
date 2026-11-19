'use client';

import { useState, useSyncExternalStore } from 'react';
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

/**
 * П9: компактный выбор темы в меню телефона — ряд кружков вместо списка из 7 строк.
 * radiogroup со стрелками (roving tabindex), у кружка тап-зона 44x44, имя темы — aria-label и подпись под рядом.
 * Меню не закрывается: можно сравнить темы подряд.
 */
export function ThemeSwatches() {
  const [theme, setTheme] = useTheme();
  // F26: подпись показывает тему под пальцем / фокусом / курсором, а не только выбранную — не приходится выбирать наугад
  const [peek, setPeek] = useState<ThemeId | null>(null);
  const cur = THEMES.find((t) => t.id === (peek ?? theme)) ?? THEMES[0];
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + THEMES.length) % THEMES.length;
    setTheme(THEMES[n].id);
    (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className="ps-themerow">
      <div className="ps-themerow__list" role="radiogroup" aria-label="Тема" data-testid="theme-swatches">
        {THEMES.map((t, i) => (
          <button
            key={t.id} type="button" role="radio" aria-checked={theme === t.id} aria-label={t.label} title={t.label}
            tabIndex={theme === t.id ? 0 : -1} className="ps-themerow__btn" onClick={() => setTheme(t.id)} onKeyDown={(e) => onKey(e, i)}
            onPointerEnter={() => setPeek(t.id)} onPointerLeave={() => setPeek(null)} onFocus={() => setPeek(t.id)} onBlur={() => setPeek(null)}
          >
            <span className="ps-swatch ps-swatch--lg" data-theme={t.attr ?? 'night'} aria-hidden="true"><span className="ps-swatch__dot" /></span>
          </button>
        ))}
      </div>
      <p className="ps-themerow__cur" aria-hidden="true" data-testid="theme-caption">
        {cur.label}{cur.id === theme ? <span className="ps-themerow__sel"> · выбрана</span> : null}
      </p>
    </div>
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
