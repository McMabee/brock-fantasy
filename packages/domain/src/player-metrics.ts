export interface PlayerSummary {
  season_label: string;
  kind: string;
  fantasy_points: number | null;
  games_played: number | null;
  supplied_adp?: number | null;
}

export function normalizeHeight(raw: string): { inches: number; centimetres: number } | null {
  const normalized = raw.trim().replace(/[′’]/gu, "'").replace(/[″“”]/gu, '"');
  const match = /^(\d)\s*(?:'|-)\s*(\d{1,2})\s*"?$/u.exec(normalized);
  if (!match) return null;
  const feet = Number(match[1]);
  const remainder = Number(match[2]);
  if (feet < 3 || feet > 8 || remainder >= 12) return null;
  const inches = feet * 12 + remainder;
  return { inches, centimetres: Math.round(inches * 2.54 * 100) / 100 };
}

export function formatHeight(inches: number | null): string {
  if (inches === null || !Number.isInteger(inches) || inches < 36 || inches > 107) return '—';
  return `${Math.floor(inches / 12)}′${inches % 12}″ · ${Math.round(inches * 2.54)} cm`;
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function playerMetrics(
  bio: Record<string, unknown>,
  summaries: readonly PlayerSummary[],
  season: string,
) {
  const height = bio.height;
  const rawInches =
    height && typeof height === 'object' && 'inches' in height ? finite(height.inches) : null;
  const inches =
    rawInches !== null && Number.isInteger(rawInches) && rawInches >= 36 && rawInches <= 107
      ? rawInches
      : null;
  const supplied = summaries.filter(
    (item) => item.kind === 'supplied_projection' && item.season_label === season,
  );
  // Conflicting records are unavailable rather than depending on database row order.
  const consistent = (key: 'fantasy_points' | 'games_played' | 'supplied_adp') => {
    const values = new Set(supplied.map((item) => finite(item[key])));
    return values.size === 1 ? (values.values().next().value ?? null) : null;
  };
  const adp = consistent('supplied_adp');
  return {
    heightInches: inches,
    heightCm: inches === null ? null : Math.round(inches * 2.54),
    heightLabel: formatHeight(inches),
    projectedPoints: consistent('fantasy_points'),
    projectedGames: consistent('games_played'),
    suppliedAdp: adp !== null && adp > 0 ? adp : null,
  };
}
