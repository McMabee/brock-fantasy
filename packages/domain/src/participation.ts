export const VARSITY_PROGRAMS = {
  mens_hockey: "Men's Hockey",
  womens_hockey: "Women's Hockey",
  mens_basketball: "Men's Basketball",
  womens_basketball: "Women's Basketball",
  mens_volleyball: "Men's Volleyball",
  womens_volleyball: "Women's Volleyball",
} as const;

export type VarsityProgram = keyof typeof VARSITY_PROGRAMS;
export type ParticipationRole = 'none' | 'athlete' | 'coach' | 'athlete_coach';
export interface Participation {
  role: ParticipationRole;
  programs: readonly VarsityProgram[];
}

export function parseParticipation(role: unknown, programs: unknown): Participation | null {
  if (!['none', 'athlete', 'coach', 'athlete_coach'].includes(String(role))) return null;
  if (!Array.isArray(programs) || programs.length > 6) return null;
  if (
    programs.some(
      (program) => typeof program !== 'string' || !Object.hasOwn(VARSITY_PROGRAMS, program),
    )
  )
    return null;
  const unique = [...new Set(programs)] as VarsityProgram[];
  if (
    unique.length !== programs.length ||
    (role === 'none' ? unique.length !== 0 : unique.length === 0)
  )
    return null;
  return { role: role as ParticipationRole, programs: unique };
}
