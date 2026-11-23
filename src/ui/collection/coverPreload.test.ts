import { afterEach, describe, expect, it, vi } from 'vitest';
import { LARGE_W } from './Cover';
import { COVER_PRELOAD_AHEAD, coverPreloadSrcs, preloadCovers } from './coverPreload';
import { psnImageUrl } from '../format';

const PSN = 'https://image.api.playstation.com/cdn/cover.png';

afterEach(() => { vi.unstubAllGlobals(); });

describe('coverPreload', () => {
  it('coverPreloadSrcs: тот же URL, что у Cover (LARGE_W), без дублей и пустых', () => {
    expect(COVER_PRELOAD_AHEAD).toBe(5);
    expect(coverPreloadSrcs([PSN, PSN, null, undefined, 'https://cdn.example.com/x.png'], LARGE_W)).toEqual([
      psnImageUrl(PSN, LARGE_W),
      'https://cdn.example.com/x.png',
    ]);
    expect(psnImageUrl(PSN, LARGE_W)).toBe(`${PSN}?w=${LARGE_W}`);
  });

  it('preloadCovers создаёт Image() с referrerPolicy и точным src', () => {
    const srcs: string[] = [];
    const policies: string[] = [];
    vi.stubGlobal('Image', class {
      referrerPolicy = '';
      decode = () => Promise.resolve();
      set src(v: string) { srcs.push(v); policies.push(this.referrerPolicy); }
      get src() { return srcs.at(-1) ?? ''; }
    });
    expect(preloadCovers([PSN, null], LARGE_W)).toEqual([psnImageUrl(PSN, LARGE_W)]);
    expect(srcs).toEqual([psnImageUrl(PSN, LARGE_W)]);
    expect(policies).toEqual(['no-referrer']);
  });
});
