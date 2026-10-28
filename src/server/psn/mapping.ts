// Маппинг сырых ответов PSN в доменные типы. Читает защитно: библиотека неофициальная, поля могут
// отсутствовать или менять тип. Ничего не бросает на плохих полях, плохие записи отбрасываются.
import { GAME_CATEGORIES } from './types';
import type { GameCategory, PsnGame, PsnProfile, PsnTrophyDef, PsnTrophyEarned, PsnTrophySet, TrophyCounts, TrophyKind } from './types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
/** Только валидный https URL (иначе null): mixed content и чужие схемы в БД не пишем (BUG-P9-2). */
export function httpsUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    return new URL(s.trim()).protocol === 'https:' ? s.trim() : null;
  } catch {
    return null;
  }
}
const INT32_MAX = 2_147_483_647;

/** ISO 8601 `PT228H56M33S` (допускает дни и дробные секунды) -> секунды. Мусор = 0. */
export function parseIsoDuration(v: unknown): number {
  if (typeof v !== 'string') return 0;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const [d, h, mi, s] = [m[1], m[2], m[3], m[4]].map((x) => (x ? Number(x) : 0));
  const total = Math.round(d * 86400 + h * 3600 + mi * 60 + s);
  return Math.min(Math.max(total, 0), INT32_MAX);
}

export function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function intOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v), 0), INT32_MAX) : 0;
}

export function isGameCategory(v: unknown): v is GameCategory {
  return typeof v === 'string' && (GAME_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Приоритет типов изображений concept.media.images для баннера (api-notes.md, «Баннер игры»).
 * Ширины/высоты PSN в этом ответе не отдаёт, поэтому выбор по `type`.
 */
export const BANNER_TYPE_PRIORITY = ['SIXTEEN_BY_NINE_BANNER', 'GAMEHUB_COVER_ART', 'FOUR_BY_THREE_BANNER', 'BACKGROUND', 'SCREENSHOT'] as const;

/**
 * Баннер: первое изображение по приоритету типов; иначе любое с числовыми width > height (если PSN их вдруг отдаст);
 * иначе null (UI рисует размытую обложку). Квадратные/вертикальные и логотипы (MASTER, LOGO, PORTRAIT_BANNER, иконки) не берутся.
 */
export function pickBanner(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const list = images.filter(isObj).filter((im) => httpsUrl(im.url));
  for (const type of BANNER_TYPE_PRIORITY) {
    const hit = list.find((im) => im.type === type);
    if (hit) return httpsUrl(hit.url);
  }
  const wide = list.find((im) => typeof im.width === 'number' && typeof im.height === 'number' && im.width > im.height);
  return wide ? httpsUrl(wide.url) : null;
}

/** Профиль из getProfileFromUserName (защитно). null, если нет onlineId. avatarUrls: берём самый крупный по size. */
export function mapProfile(raw: unknown): PsnProfile | null {
  const p = isObj(raw) && isObj(raw.profile) ? raw.profile : null;
  if (!p) return null;
  const onlineId = str(p.onlineId);
  if (!onlineId) return null;

  let avatarUrl: string | null = null;
  if (Array.isArray(p.avatarUrls)) {
    // size: 'xl' | 'l' | 'm' | 's' | 'xs'
    const rank: Record<string, number> = { xl: 5, l: 4, m: 3, s: 2, xs: 1 };
    let best = -1;
    for (const a of p.avatarUrls) {
      if (!isObj(a)) continue;
      const url = httpsUrl(a.avatarUrl);
      if (!url) continue;
      const r = typeof a.size === 'string' ? (rank[a.size.toLowerCase()] ?? 0) : 0;
      if (r > best) {
        best = r;
        avatarUrl = url;
      }
    }
  }

  const ts = isObj(p.trophySummary) ? p.trophySummary : null;
  const optInt = (v: unknown, max: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.trunc(v), max) : null;
  const et = ts && isObj(ts.earnedTrophies) ? ts.earnedTrophies : null;
  const cnt = et
    ? { platinum: optInt(et.platinum, INT32_MAX), gold: optInt(et.gold, INT32_MAX), silver: optInt(et.silver, INT32_MAX), bronze: optInt(et.bronze, INT32_MAX) }
    : null;
  return {
    onlineId,
    avatarUrl,
    trophyLevel: optInt(ts?.level, 32767),
    trophyProgress: optInt(ts?.progress, 100),
    trophyTier: optInt(ts?.tier, 32767),
    earned: cnt && cnt.platinum !== null && cnt.gold !== null && cnt.silver !== null && cnt.bronze !== null ? { platinum: cnt.platinum, gold: cnt.gold, silver: cnt.silver, bronze: cnt.bronze } : null,
  };
}

/** Сырой тайтл из getUserPlayedGames -> игра. null, если это не игра (category) или нет titleId. */
export function mapPlayedTitle(raw: unknown): PsnGame | null {
  if (!isObj(raw)) return null;
  if (!isGameCategory(raw.category)) return null;
  const titleId = str(raw.titleId);
  if (!titleId) return null;
  const concept = isObj(raw.concept) ? raw.concept : null;
  const name = str(raw.localizedName) ?? str(raw.name) ?? str(concept?.name);
  if (!name) return null;

  let image = str(raw.imageUrl) ?? str(raw.localizedImageUrl);
  if (!image && concept && isObj(concept.media) && Array.isArray(concept.media.images)) {
    for (const im of concept.media.images) {
      if (isObj(im) && str(im.url)) {
        image = str(im.url);
        break;
      }
    }
  }

  const bannerUrl = concept && isObj(concept.media) ? pickBanner(concept.media.images) : null;

  const conceptIdRaw = concept?.id;
  const conceptId =
    typeof conceptIdRaw === 'number' || (typeof conceptIdRaw === 'string' && conceptIdRaw !== '') ? String(conceptIdRaw) : null;
  const genres = Array.isArray(concept?.genres) ? (concept.genres as unknown[]).filter((g): g is string => typeof g === 'string' && g !== '') : [];

  return {
    titleId,
    conceptId,
    name,
    category: raw.category,
    imageUrl: image,
    bannerUrl,
    genres,
    playDurationSeconds: parseIsoDuration(raw.playDuration),
    playCount: intOr0(raw.playCount),
    firstPlayedAt: parseDate(raw.firstPlayedDateTime),
    lastPlayedAt: parseDate(raw.lastPlayedDateTime),
  };
}

/** Список тайтлов -> игры без дублей titleId (при дубле побеждает запись с большим временем). */
export function mapPlayedTitles(rawTitles: unknown[]): { games: PsnGame[]; skipped: number } {
  const byId = new Map<string, PsnGame>();
  let skipped = 0;
  for (const raw of rawTitles) {
    const g = mapPlayedTitle(raw);
    if (!g) {
      skipped++;
      continue;
    }
    const prev = byId.get(g.titleId);
    if (!prev || g.playDurationSeconds >= prev.playDurationSeconds) byId.set(g.titleId, g);
  }
  return { games: [...byId.values()], skipped };
}

function counts(v: unknown): TrophyCounts {
  const o = isObj(v) ? v : {};
  return { bronze: intOr0(o.bronze), silver: intOr0(o.silver), gold: intOr0(o.gold), platinum: intOr0(o.platinum) };
}

export function mapTrophyTitle(raw: unknown): PsnTrophySet | null {
  if (!isObj(raw)) return null;
  const npCommunicationId = str(raw.npCommunicationId);
  if (!npCommunicationId) return null;
  const progress = typeof raw.progress === 'number' && Number.isFinite(raw.progress) ? Math.min(Math.max(Math.round(raw.progress), 0), 100) : 0;
  return {
    npCommunicationId,
    npServiceName: raw.npServiceName === 'trophy2' ? 'trophy2' : 'trophy',
    name: str(raw.trophyTitleName) ?? npCommunicationId,
    platform: str(raw.trophyTitlePlatform),
    iconUrl: str(raw.trophyTitleIconUrl),
    defined: counts(raw.definedTrophies),
    earned: counts(raw.earnedTrophies),
    progress,
    lastUpdatedAt: parseDate(raw.lastUpdatedDateTime),
  };
}

const TROPHY_KINDS: readonly string[] = ['bronze', 'silver', 'gold', 'platinum'];
const kind = (v: unknown): TrophyKind | null => (typeof v === 'string' && TROPHY_KINDS.includes(v) ? (v as TrophyKind) : null);

/** trophyGroupId как есть (`default`, `001`...); нет поля -> null (контракт 15.3). */
const groupId = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 16) : null);

export function mapEarnedTrophy(raw: unknown): PsnTrophyEarned | null {
  if (!isObj(raw)) return null;
  const type = kind(raw.trophyType);
  if (typeof raw.trophyId !== 'number' || !Number.isInteger(raw.trophyId) || !type) return null;
  const earned = raw.earned === true;
  const rare = typeof raw.trophyRare === 'number' && raw.trophyRare >= 0 && raw.trophyRare <= 3 ? Math.trunc(raw.trophyRare) : null;
  const rateNum = typeof raw.trophyEarnedRate === 'string' || typeof raw.trophyEarnedRate === 'number' ? Number(raw.trophyEarnedRate) : NaN;
  return {
    trophyId: raw.trophyId,
    groupId: groupId(raw.trophyGroupId),
    type,
    hidden: raw.trophyHidden === true,
    earned,
    earnedAt: earned ? parseDate(raw.earnedDateTime) : null,
    rarity: rare,
    earnedRate: Number.isFinite(rateNum) ? Math.min(Math.max(rateNum, 0), 100).toFixed(2) : null,
  };
}

export function mapTrophyDef(raw: unknown): PsnTrophyDef | null {
  if (!isObj(raw)) return null;
  const type = kind(raw.trophyType);
  if (typeof raw.trophyId !== 'number' || !Number.isInteger(raw.trophyId) || !type) return null;
  return {
    trophyId: raw.trophyId,
    groupId: groupId(raw.trophyGroupId),
    type,
    hidden: raw.trophyHidden === true,
    name: str(raw.trophyName),
    detail: str(raw.trophyDetail),
    iconUrl: str(raw.trophyIconUrl),
  };
}
