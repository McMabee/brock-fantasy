import { describe, expect, it } from 'vitest';
import { formatFantasyPoints } from './format';

describe('fantasy-point display', () => {
  it('preserves goalie and volleyball fractions instead of rounding them to whole points', () => {
    expect(formatFantasyPoints(227.4)).toBe('227.4');
    expect(formatFantasyPoints(0.25)).toBe('0.25');
    expect(formatFantasyPoints(-14.4)).toBe('-14.4');
    expect(formatFantasyPoints(0)).toBe('0.0');
    expect(formatFantasyPoints(null)).toBe('Pending');
    expect(formatFantasyPoints(Number.NaN)).toBe('Pending');
  });
});
