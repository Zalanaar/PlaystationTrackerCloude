// N-1 (22.12): подзапросы видимости несут user_id и не сканируют игры других пользователей.
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { gameVisible, trophySetCounted } from './visibility';

const q = (s: Parameters<PgDialect['sqlToQuery']>[0]) => new PgDialect().sqlToQuery(s);

describe('visibility: user_id в подзапросах', () => {
  it('gameVisible фильтрует games по пользователю', () => {
    const r = q(gameVisible(schema.gameStatus.gameId, 7));
    expect(r.sql).toMatch(/from "games" where "user_id" = \$1 and "hidden_at" is null/);
    expect(r.params).toEqual([7]);
  });

  it('trophySetCounted фильтрует и связи, и игры по пользователю', () => {
    const r = q(trophySetCounted(schema.trophies.trophySetId, 9));
    expect(r.sql).toContain('g."user_id" = $1');
    expect(r.sql).toContain('gts."user_id" = $2');
    expect(r.params).toEqual([9, 9]);
  });
});
