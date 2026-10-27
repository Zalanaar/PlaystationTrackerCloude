import { THEMES, THEME_STORAGE_KEY } from './tokens';

/** Inline-скрипт для <head>: ставит data-theme до первой отрисовки. Для night атрибут не ставится. */
const attrs = THEMES.filter((t) => t.attr).map((t) => t.attr);

export const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var a=${JSON.stringify(attrs)};var e=document.documentElement;if(t==='night'||a.indexOf(t)<0){e.removeAttribute('data-theme');}else{e.setAttribute('data-theme',t);}}catch(e){}})();`;
