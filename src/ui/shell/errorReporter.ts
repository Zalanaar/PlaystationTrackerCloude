'use client';
// П10: журнал ошибок браузера. Необработанные ошибки и отклонённые промисы уходят в POST /api/client-errors
// (без внешних сервисов). Шум отбрасывается: расширения, «Script error.», ResizeObserver, отмена запросов.
// Не больше 10 отправок за загрузку страницы, одинаковые тексты — один раз.

export const REPORT_MAX_PER_PAGE = 10;
const IGNORE = [/^Script error\.?$/i, /ResizeObserver loop/i, /AbortError/i, /The user aborted a request/i, /Load failed$/i, /^cancelled$/i];

export type ErrorReport = { kind: 'error' | 'rejection'; message: string; source: string | null; stack: string | null };

/** Отправлять ли: не пусто, не шум, источник — наш сайт (не расширение браузера). */
export function shouldReport(r: ErrorReport, origin: string): boolean {
  const m = r.message.trim();
  if (!m || IGNORE.some((re) => re.test(m))) return false;
  if (r.source && /^[a-z-]+-extension:|^moz-extension:|^safari-web-extension:/i.test(r.source)) return false;
  if (r.source && /^https?:/i.test(r.source) && !r.source.startsWith(origin)) return false;
  return true;
}

/** Из события ошибки / отклонения — отчёт (путь к файлу без origin). */
export function toReport(e: { kind: 'error' | 'rejection'; reason?: unknown; error?: unknown; message?: string; filename?: string; lineno?: number; colno?: number }, origin: string): ErrorReport {
  const err = e.kind === 'rejection' ? e.reason : e.error;
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : typeof err === 'string' ? err : e.message ?? String(err ?? '');
  const file = e.filename ? `${e.filename.startsWith(origin) ? e.filename.slice(origin.length) : e.filename}${e.lineno ? `:${e.lineno}:${e.colno ?? 0}` : ''}` : null;
  return { kind: e.kind, message: msg.slice(0, 500), source: file, stack: err instanceof Error && err.stack ? err.stack.slice(0, 2000) : null };
}

let installed = false;

/** Подключить один раз (AppShell). Возвращает функцию снятия (для тестов и StrictMode). */
export function installErrorReporter(send: (body: unknown) => void = defaultSend): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;
  const seen = new Set<string>();
  let sent = 0;
  const report = (r: ErrorReport) => {
    if (sent >= REPORT_MAX_PER_PAGE || !shouldReport(r, location.origin) || seen.has(r.message)) return;
    seen.add(r.message);
    sent++;
    send({ ...r, path: location.pathname, ua: navigator.userAgent.slice(0, 200) });
  };
  const onError = (e: ErrorEvent) => report(toReport({ kind: 'error', error: e.error, message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno }, location.origin));
  const onRejection = (e: PromiseRejectionEvent) => report(toReport({ kind: 'rejection', reason: e.reason }, location.origin));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => { installed = false; window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
}

function defaultSend(body: unknown): void {
  try {
    void fetch('/api/client-errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true, credentials: 'same-origin' }).catch(() => {});
  } catch { /* журнал не должен ронять страницу */ }
}
