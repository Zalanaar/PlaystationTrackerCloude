import { describe, expect, it } from 'vitest';
import { effectiveGenres, normalizeGenre, normalizeGenres } from './genres';

describe('жанры', () => {
  it('алиасы и регистр', () => {
    expect(normalizeGenre('SIMULATOR')).toBe('SIMULATION');
    expect(normalizeGenre('unique')).toBe('OTHER');
    expect(normalizeGenre('MUSIC/RHYTHM')).toBe('MUSIC_RHYTHM');
    expect(normalizeGenre('role_playing_games')).toBe('ROLE_PLAYING_GAMES');
    expect(normalizeGenre('WHATEVER')).toBe('OTHER');
  });
  it('дубли схлопываются, порядок сохраняется', () => {
    expect(normalizeGenres(['SIMULATOR', 'ACTION', 'SIMULATION', 'UNIQUE', 'FOO'])).toEqual(['SIMULATION', 'ACTION', 'OTHER']);
  });
  it('пусто = OTHER', () => {
    expect(normalizeGenres([])).toEqual(['OTHER']);
    expect(normalizeGenres(null)).toEqual(['OTHER']);
  });
  it('override приоритетнее', () => {
    expect(effectiveGenres(['ACTION'], ['PUZZLE'])).toEqual(['PUZZLE']);
    expect(effectiveGenres(['ACTION'], null)).toEqual(['ACTION']);
  });
});
