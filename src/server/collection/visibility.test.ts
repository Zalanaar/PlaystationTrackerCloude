// N-1 (22.12): подзапросы видимости несут user_id и не сканируют игры других пользователей.
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { gameVisible, snapshotGameVisible, trophySetCounted } from './visibility';

const q = (s: Parameters<PgDialect['sqlToQuery']>[0]) => new PgDialect().sqlToQuery(s);

describe('visibility: user_id в подзапросах', () => {
  it('gameVisible фильтрует games по пользователю', () => {
    const r = q(gameVisible(schema.gameStatus.gameId, 7));
    expect(r.sql).toMatch(/from "games" where "user_id" = \$1 and "hidden_at" is null/);
    expect(r.params).toEqual([7]);
  });

  it('gameVisible прячет дубли, snapshotGameVisible их оставляет и фильтрует по пользователю', () => {
    expect(q(gameVisible(schema.gameStatus.gameId, 7)).sql).toContain('"duplicate_of_game_id" is null');
    const r = q(snapshotGameVisible(schema.playtimeSnapshots.gameId, 7));
    expect(r.params).toEqual([7, 7]);
    expect(r.sql).toContain('g."duplicate_of_game_id" is null or'); // дубль проходит, если главная не скрыта
  });

  it('trophySetCounted фильтрует и связи, и игры по пользователю', () => {
    const r = q(trophySetCounted(schema.trophies.trophySetId, 9));
    expect(r.sql).toContain('g."user_id" = $1');
    expect(r.sql).toContain('p."user_id" = $2');
    expect(r.sql).toContain('gts."user_id" = $3');
    expect(r.params).toEqual([9, 9, 9]);
  });
});
