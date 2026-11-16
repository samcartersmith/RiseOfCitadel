import { z } from 'zod';

/** M0 hero schema: identity only. M2-02 adds stats, abilities and modifiers. */
export const HeroSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'lowercase snake_case id'),
  name: z.string().min(1),
  attribute: z.enum(['strength', 'agility', 'intelligence']),
  attackType: z.enum(['melee', 'ranged']),
  faction: z.enum(['wardens', 'hollow']),
  roles: z.array(z.string()).min(1),
});

export type Hero = z.infer<typeof HeroSchema>;
