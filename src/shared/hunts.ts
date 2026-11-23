// «Охочусь сейчас»: одна игра за платиной и до пяти закреплённых трофеев.
export const HUNT_TROPHY_LIMIT = 5;

export type HuntTrophyType = 'platinum' | 'gold' | 'silver' | 'bronze';

export type HuntGame = {
  id: number;
  title: string;
  coverUrl: string | null;
  earned: number;
  defined: number;
  remaining: number;
  progress: number;
  platEarned: boolean;
};

export type HuntTrophy = {
  gameId: number;
  setId: number;
  trophyId: number;
  gameTitle: string;
  coverUrl: string | null;
  name: string | null;
  iconUrl: string | null;
  type: HuntTrophyType;
  hidden: boolean;
  earned: boolean;
};

export type HuntsView = { game: HuntGame | null; trophies: HuntTrophy[] };

export function parseHuntGameBody(body: unknown): { ok: true; gameId: number | null } | { ok: false } {
  if (!body || typeof body !== 'object') return { ok: false };
  const gameId = (body as { gameId?: unknown }).gameId;
  if (gameId === null) return { ok: true, gameId: null };
  if (typeof gameId === 'number' && Number.isInteger(gameId) && gameId > 0) return { ok: true, gameId };
  return { ok: false };
}

export function parseHuntTrophyBody(body: unknown): { ok: true; gameId: number; setId: number; trophyId: number; on: boolean } | { ok: false } {
  if (!body || typeof body !== 'object') return { ok: false };
  const b = body as Record<string, unknown>;
  const id = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0;
  // trophyId в PSN может быть 0 (платина часто с id 0)
  const tid = typeof b.trophyId === 'number' && Number.isInteger(b.trophyId) && b.trophyId >= 0;
  if (!id(b.gameId) || !id(b.setId) || !tid || typeof b.on !== 'boolean') return { ok: false };
  return { ok: true, gameId: b.gameId as number, setId: b.setId as number, trophyId: b.trophyId as number, on: b.on };
}
