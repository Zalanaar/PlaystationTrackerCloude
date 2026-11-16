import { describe, expect, it } from 'vitest';
import { MC_BLOCKS, mcBlocksOn } from './ProfileCard';

describe('Memory Card: блоки уровня', () => {
  it('15 блоков, заполнено по доле с округлением и в пределах 0..15', () => {
    expect(MC_BLOCKS).toBe(15);
    expect(mcBlocksOn(0)).toBe(0);
    expect(mcBlocksOn(3)).toBe(0);
    expect(mcBlocksOn(4)).toBe(1);
    expect(mcBlocksOn(47)).toBe(7);
    expect(mcBlocksOn(93)).toBe(14);
    expect(mcBlocksOn(100)).toBe(15);
    expect(mcBlocksOn(140)).toBe(15);
    expect(mcBlocksOn(-5)).toBe(0);
  });
});
