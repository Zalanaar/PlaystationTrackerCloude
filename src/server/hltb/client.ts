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

  async function discover(): Promise<Init> {
    let sawBlock = false;
    for (const ep of HLTB_ENDPOINTS) {
      const res = await call(`${HLTB_ORIGIN}${ep.init}?t=${Date.now()}`, { headers });
      if (res.status === 403 || res.status === 429) {
        await res.body?.cancel();
        sawBlock = true;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        continue;
      }
      let j: unknown;
      try {
        j = await readJson(res);
      } catch {
        continue;
      }
      const r = rec(j);
      if (r && typeof r.token === 'string') {
        return { search: ep.search, token: r.token, hpKey: typeof r.hpKey === 'string' ? r.hpKey : '', hpVal: typeof r.hpVal === 'string' ? r.hpVal : '' };
      }
    }
    throw new HltbError(sawBlock ? 'blocked' : 'unavailable', sawBlock ? 'HLTB: доступ запрещён' : 'HLTB: не найден рабочий эндпоинт');
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
