import { LEGACY_THEME_ALIASES, THEMES, THEME_COLORS, THEME_STORAGE_KEY } from './tokens';

/**
 * Inline-скрипт для <head>: ставит data-theme и data-xmb-month до первой отрисовки. Для night атрибута темы нет.
 * Источник: localStorage, затем cookie. Старый id (activity) заменяется по LEGACY_THEME_ALIASES и записывается обратно
 * (localStorage + cookie); неизвестное значение -> Night. Месяц по Europe/Moscow.
 */
const attrs = THEMES.filter((t) => t.attr).map((t) => t.attr);
const COLORS = JSON.stringify(Object.fromEntries(THEMES.map((t) => [t.attr ?? 'night', THEME_COLORS[t.id]])));
const K = JSON.stringify(THEME_STORAGE_KEY);

export const themeInitScript = `(function(){var e=document.documentElement;try{var k=${K};var al=${JSON.stringify(LEGACY_THEME_ALIASES)};var a=${JSON.stringify(attrs)};var t=null;try{t=localStorage.getItem(k);}catch(x){}if(t===null){var m=(document.cookie||'').match(new RegExp('(?:^|; )'+k+'=([^;]*)'));if(m)t=decodeURIComponent(m[1]);}var n=t;if(t!==null&&Object.prototype.hasOwnProperty.call(al,t))n=al[t];if(n===null||n==='night'||a.indexOf(n)<0)e.removeAttribute('data-theme');else e.setAttribute('data-theme',n);if(t!==null&&n!==t&&a.indexOf(n)>=0){try{localStorage.setItem(k,n);}catch(x){}document.cookie=k+'='+n+'; path=/; max-age=31536000; samesite=lax';}try{var cl=(${COLORS})[n===null||n==='night'||a.indexOf(n)<0?'night':n];var ms=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<ms.length;i++){ms[i].setAttribute('content',cl);ms[i].removeAttribute('media');}}catch(x){}var mo=+new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Moscow',month:'numeric'}).format(new Date());if(mo>=1&&mo<=12)e.setAttribute('data-xmb-month',String(mo));}catch(x){}})();`;
