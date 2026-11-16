import { describe, expect, it } from 'vitest';
import { HeroSchema } from '../src';
import bulwark from '../data/heroes/bulwark.json';

describe('HeroSchema', () => {
  it('accepts shipped hero data', () => {
    expect(HeroSchema.safeParse(bulwark).success).toBe(true);
  });

  it('rejects bad ids and attributes', () => {
    expect(HeroSchema.safeParse({ ...bulwark, id: 'Bad Id' }).success).toBe(false);
    expect(HeroSchema.safeParse({ ...bulwark, attribute: 'luck' }).success).toBe(false);
  });
});
