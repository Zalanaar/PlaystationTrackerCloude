// Клиент HowLongToBeat. ЕДИНСТВЕННОЕ место с сетью к HLTB (контракт 16.6). Неофициальный: формат и пути меняются.
// Тела ответов в ошибки не попадают. Таймаут на каждый запрос.
import { secondsToHours, type HltbCandidate } from './normalize';

export type HltbErrorCode = 'timeout' | 'blocked' | 'unavailable' | 'bad_response';
export class HltbError extends Error {
  constructor(readonly code: HltbErrorCode, message: string) {
    super(message);
    this.name = 'HltbError';
  }
}

export const HLTB_ORIGIN = 'https://howlongtobeat.com';
export const HLTB_TIMEOUT_MS = 8000;
export const HLTB_MAX_BYTES = 2 * 1024 * 1024;
/** Известные варианты пути (HLTB их периодически меняет): init выдаёт токен, search принимает запрос. */
export const HLTB_ENDPOINTS = [
  { init: '/api/find/init', search: '/api/find' },
  { init: '/api/bleed/init', search: '/api/bleed' },
  { init: '/api/search/init', search: '/api/search' },
] as const;
export const HLTB_SCRIPT_MAX_BYTES = 6 * 1024 * 1024;
/** Общий бюджет поиска рабочего пути (известные пути + разбор страницы). */
export const HLTB_DISCOVER_BUDGET_MS = 20000;
export const HLTB_DETAIL_MAX = 300;
/** Ограничивает безопасную диагностику по длине (в sync_runs.warnings). */
export function capDetail(s: string, max = HLTB_DETAIL_MAX): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type HltbClient = { search: (term: string) => Promise<HltbCandidate[]> };
type Init = { search: string; token: string; hpKey: string; hpVal: string };

async function readJson(res: Response): Promise<unknown> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > HLTB_MAX_BYTES) {
    await res.body?.cancel();
    throw new HltbError('bad_response', 'HLTB: слишком большой ответ');
  }
  const text = await res.text();
  if (text.length > HLTB_MAX_BYTES) throw new HltbError('bad_response', 'HLTB: слишком большой ответ');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HltbError('bad_response', 'HLTB: ответ не JSON');
  }
}

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Разбор ответа поиска. Неожиданная форма = bad_response (не «ничего не найдено»). */
export function parseSearchResponse(json: unknown): HltbCandidate[] {
  const data = rec(json)?.data;
  if (!Array.isArray(data)) throw new HltbError('bad_response', 'HLTB: нет поля data');
  const out: HltbCandidate[] = [];
  for (const item of data) {
    const o = rec(item);
    if (!o) continue;
    const id = o.game_id;
    const name = o.game_name;
    if (typeof id !== 'number' || !Number.isInteger(id) || typeof name !== 'string') {
      throw new HltbError('bad_response', 'HLTB: неожиданный формат записи игры');
    }
    out.push({ id, name, mainHours: secondsToHours(o.comp_main), extraHours: secondsToHours(o.comp_plus) });
  }
  return out;
}

export function searchBody(term: string, hp?: { key: string; val: string }): Record<string, unknown> {
  return {
    searchType: 'games',
    searchTerms: term.split(/\s+/).filter(Boolean),
    searchPage: 1,
    size: 20,
    searchOptions: {
      games: {
        userId: 0,
        platform: '',
        sortCategory: 'popular',
        rangeCategory: 'main',
        rangeTime: { min: 0, max: 0 },
        gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
        rangeYear: { min: '', max: '' },
        modifier: '',
      },
      users: { sortCategory: 'postcount' },
      lists: { sortCategory: 'follows' },
      filter: '',
      sort: 0,
      randomizer: 0,
    },
    useCache: true,
    ...(hp ? { [hp.key]: hp.val } : {}),
  };
}

export function createHltbClient(o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): HltbClient {
  const f = o.fetchImpl ?? fetch;
  const timeoutMs = o.timeoutMs ?? HLTB_TIMEOUT_MS;
  let init: Init | null = null;

  const call = async (url: string, init2: RequestInit): Promise<Response> => {
    try {
      return await f(url, { ...init2, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new HltbError(timeout ? 'timeout' : 'unavailable', timeout ? 'HLTB: таймаут' : 'HLTB: сеть недоступна');
    }
  };
  const headers = { 'user-agent': UA, referer: `${HLTB_ORIGIN}/`, origin: HLTB_ORIGIN };

  /** Один пробный init. Возвращает Init либо безопасный тег сбоя (без тел ответов): HTTP-статус, network, timeout, not_json, too_large, "200 no_token". */
  async function tryInit(path: string): Promise<{ init: Init } | { fail: string; block?: boolean }> {
    let res: Response;
    try {
      res = await call(`${HLTB_ORIGIN}/api/${path}/init?t=${Date.now()}`, { headers });
    } catch (e) {
      return { fail: e instanceof HltbError && e.code === 'timeout' ? 'timeout' : 'network' };
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { fail: String(res.status), block: res.status === 403 || res.status === 429 };
    }
    let j: unknown;
    try {
      j = await readJson(res);
    } catch (e) {
      return { fail: e instanceof Error && e.message.includes('JSON') ? 'not_json' : 'too_large' };
    }
    const r = rec(j);
    if (r && typeof r.token === 'string') {
      return { init: { search: `/api/${path}`, token: r.token, hpKey: typeof r.hpKey === 'string' ? r.hpKey : '', hpVal: typeof r.hpVal === 'string' ? r.hpVal : '' } };
    }
    return { fail: `${res.status} no_token` };
  }

  /** Текст страницы/скрипта HLTB (только свой origin) с лимитом размера; null при любом сбое. */
  async function getText(path: string, maxBytes: number): Promise<string | null> {
    try {
      const res = await call(`${HLTB_ORIGIN}${path}`, { headers });
      if (!res.ok) {
        await res.body?.cancel();
        return null;
      }
      const text = await res.text();
      return text.length > maxBytes ? null : text;
    } catch {
      return null;
    }
  }

  /**
   * Запасной поиск пути: главная страница -> скрипт _app-*.js -> `fetch("/api/<имя>...")`. Формат неофициальный и не проверен вживую:
   * найденное имя принимается только если его init реально вернул token (см. tryInit), иначе это просто ещё одна строка диагностики.
   */
  async function scrapePaths(skip: Set<string>): Promise<{ paths: string[]; note: string }> {
    const home = await getText('/', HLTB_MAX_BYTES);
    if (home === null) return { paths: [], note: 'главная: недоступна' };
    const src = /<script[^>]+src="(\/_next\/static\/[^"]*_app-[^"]*\.js)"/.exec(home)?.[1];
    if (!src) return { paths: [], note: 'главная: нет _app-скрипта' };
    const js = await getText(src, HLTB_SCRIPT_MAX_BYTES);
    if (js === null) return { paths: [], note: '_app: недоступен' };
    const found = new Set<string>();
    for (const m of js.matchAll(/fetch\(\s*["'`]\/api\/([a-zA-Z0-9_]{1,32})[/"'`?]/g)) {
      if (!skip.has(m[1])) found.add(m[1]);
    }
    return { paths: [...found].slice(0, 3), note: found.size === 0 ? '_app: путь не найден' : '' };
  }

  let discoverFailure: HltbError | null = null;
  async function discover(): Promise<Init> {
    // после неудачи в рамках жизни клиента (один запуск синка) сеть не дёргаем повторно
    if (discoverFailure) throw discoverFailure;
    const started = Date.now();
    const parts: string[] = [];
    let sawBlock = false;
    let sawTimeout = false;
    let fails = 0;
    let timeouts = 0;
    const tried = new Set<string>();
    const attempt = async (path: string): Promise<Init | null> => {
      tried.add(path);
      const r = await tryInit(path);
      if ('init' in r) return r.init;
      if (r.block) sawBlock = true;
      fails++;
      if (r.fail === 'timeout') {
        sawTimeout = true;
        timeouts++;
      }
      parts.push(`init /api/${path}/init: ${r.fail}`);
      return null;
    };
    const finish = (): never => {
      const detail = capDetail(parts.join('; '));
      const code: HltbErrorCode = sawBlock ? 'blocked' : fails > 0 && timeouts === fails ? 'timeout' : 'unavailable';
      discoverFailure = new HltbError(code, `${sawBlock ? 'HLTB: доступ запрещён' : 'HLTB: не найден рабочий эндпоинт'}: ${detail}`);
      throw discoverFailure;
    };
    for (const ep of HLTB_ENDPOINTS) {
      const path = ep.init.split('/')[2];
      const got = await attempt(path);
      if (got) return got;
    }
    if (Date.now() - started < HLTB_DISCOVER_BUDGET_MS && !sawTimeout) {
      const { paths, note } = await scrapePaths(tried);
      if (note) parts.push(note);
      for (const path of paths) {
        if (Date.now() - started >= HLTB_DISCOVER_BUDGET_MS) {
          parts.push('бюджет времени');
          break;
        }
        const got = await attempt(path);
        if (got) return got;
      }
    } else {
      parts.push('поиск пути пропущен');
    }
    return finish();
  }

  return {
    async search(term) {
      for (let attempt = 0; attempt < 2; attempt++) {
        init ??= await discover();
        const hp = init.hpKey ? { key: init.hpKey, val: init.hpVal } : undefined;
        const res = await call(`${HLTB_ORIGIN}${init.search}`, {
          method: 'POST',
          headers: {
            ...headers,
            'content-type': 'application/json',
            ...(init.token ? { 'x-auth-token': init.token } : {}),
            ...(hp ? { 'x-hp-key': hp.key, 'x-hp-val': hp.val } : {}),
          },
          body: JSON.stringify(searchBody(term, hp)),
        });
        // токен протух: один раз получаем новый
        if ((res.status === 401 || res.status === 403) && attempt === 0) {
          await res.body?.cancel();
          init = null;
          continue;
        }
        if (res.status === 403 || res.status === 429) {
          await res.body?.cancel();
          throw new HltbError('blocked', `HLTB: HTTP ${res.status}`);
        }
        if (!res.ok) {
          await res.body?.cancel();
          throw new HltbError('unavailable', `HLTB: HTTP ${res.status}`);
        }
        return parseSearchResponse(await readJson(res));
      }
      throw new HltbError('blocked', 'HLTB: доступ запрещён');
    },
  };
}
