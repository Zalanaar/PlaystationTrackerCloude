// Тонкая обёртка над localStorage/sessionStorage для подсказки «Установить». Любая ошибка хранилища не падает.
import { INSTALL_KEYS, VISIT_COUNTED_KEY, addVisit, parseStored, type InstallStored } from './install-model';

function local(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
function session(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** null: localStorage недоступен */
export function readInstall(): InstallStored | null {
  const ls = local();
  if (!ls) return null;
  try {
    return parseStored({
      visits: ls.getItem(INSTALL_KEYS.visits), snooze: ls.getItem(INSTALL_KEYS.snooze),
      dismissals: ls.getItem(INSTALL_KEYS.dismissals), done: ls.getItem(INSTALL_KEYS.done),
    });
  } catch { return null; }
}

export function writeInstall(s: InstallStored): void {
  const ls = local();
  if (!ls) return;
  try {
    ls.setItem(INSTALL_KEYS.visits, String(s.visits));
    ls.setItem(INSTALL_KEYS.dismissals, String(s.dismissals));
    if (s.snoozeUntil === null) ls.removeItem(INSTALL_KEYS.snooze); else ls.setItem(INSTALL_KEYS.snooze, new Date(s.snoozeUntil).toISOString());
    if (s.done) ls.setItem(INSTALL_KEYS.done, '1'); else ls.removeItem(INSTALL_KEYS.done);
  } catch { /* приватный режим */ }
}

let counted = false;

/** +1 к счётчику визитов за вкладку/сессию (флаг в sessionStorage). Возвращает актуальное состояние. */
export function countVisit(): InstallStored | null {
  const cur = readInstall();
  if (cur === null) return null;
  const ss = session();
  let already = counted;
  try { if (ss?.getItem(VISIT_COUNTED_KEY)) already = true; } catch { /* нет sessionStorage */ }
  if (already) return cur;
  counted = true;
  try { ss?.setItem(VISIT_COUNTED_KEY, '1'); } catch { /* нет sessionStorage */ }
  const next = addVisit(cur);
  writeInstall(next);
  return next;
}
