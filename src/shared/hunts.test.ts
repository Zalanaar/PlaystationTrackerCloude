import { describe, expect, it } from 'vitest';
import { parseHuntGameBody, parseHuntTrophyBody } from './hunts';

describe('разбор тела охоты', () => {
  it('игра: id или null', () => {
    expect(parseHuntGameBody({ gameId: null })).toEqual({ ok: true, gameId: null });
    expect(parseHuntGameBody({ gameId: 7 })).toEqual({ ok: true, gameId: 7 });
    expect(parseHuntGameBody({ gameId: 0 })).toEqual({ ok: false });
    expect(parseHuntGameBody({})).toEqual({ ok: false });
  });
  it('трофей: нулевой trophyId допустим, on обязателен', () => {
    expect(parseHuntTrophyBody({ gameId: 1, setId: 2, trophyId: 0, on: true })).toEqual({ ok: true, gameId: 1, setId: 2, trophyId: 0, on: true });
    expect(parseHuntTrophyBody({ gameId: 1, setId: 2, trophyId: 3, on: false })).toMatchObject({ on: false });
    expect(parseHuntTrophyBody({ gameId: 1, setId: 2, trophyId: 3 })).toEqual({ ok: false });
    expect(parseHuntTrophyBody({ gameId: 1, setId: 0, trophyId: 3, on: true })).toEqual({ ok: false });
  });
});
