export interface AdminRankingRow {
  athlete_id: string;
  name: string;
  position_group: string;
  projected_points: number | null;
  position_rank: number | null;
  display_data: {
    supporting_statistics?: {
      season_label: string;
      games_played: number | null;
      fantasy_points: number | null;
      stats: Record<string, number>;
    } | null;
    name?: string;
    position?: string;
    program?: string;
    division?: string;
    bio?: Record<string, unknown>;
    season_label?: string;
    games_played?: number | null;
    stats?: Record<string, number>;
    sources?: string[];
  };
}
export interface RankingReview {
  season: string | null;
  poolId: string | null;
  canPublish: boolean;
  preview: boolean;
  input_hash: string | null;
  rows: AdminRankingRow[];
  publication: { version: number; published_at: string } | null;
}
export interface RankingPair {
  id: string;
  rank: number | null;
  women: AdminRankingRow[];
  men: AdminRankingRow[];
}

// - Rank each division once and preserve competition ties without changing stored ranks
export function pairRankingRows(rows: readonly AdminRankingRow[]): Map<string, RankingPair[]> {
  const groups = new Map<string, { women: AdminRankingRow[]; men: AdminRankingRow[] }>();
  for (const row of rows) {
    let group = groups.get(row.position_group);
    if (!group) {
      group = { women: [], men: [] };
      groups.set(row.position_group, group);
    }
    if (row.display_data.division === 'womens') group.women.push(row);
    else if (row.display_data.division === 'mens') group.men.push(row);
  }
  const result = new Map<string, RankingPair[]>();
  for (const [position, divisions] of groups) {
    const pairs = new Map<number, RankingPair>();
    const unranked: { women: AdminRankingRow[]; men: AdminRankingRow[] } = { women: [], men: [] };
    for (const side of ['women', 'men'] as const) {
      const sorted = [...divisions[side]].sort(
        (a, b) =>
          (b.projected_points ?? -Infinity) - (a.projected_points ?? -Infinity) ||
          a.name.localeCompare(b.name) ||
          a.athlete_id.localeCompare(b.athlete_id),
      );
      let previous: number | null = null,
        rank = 0;
      sorted.forEach((row, index) => {
        if (row.projected_points == null) {
          unranked[side].push(row);
          return;
        }
        if (row.projected_points !== previous) rank = index + 1;
        previous = row.projected_points;
        let pair = pairs.get(rank);
        if (!pair) {
          pair = { id: String(rank), rank, women: [], men: [] };
          pairs.set(rank, pair);
        }
        pair[side].push(row);
      });
    }
    const ordered = [...pairs.values()].sort((a, b) => a.rank! - b.rank!);
    for (let index = 0; index < Math.max(unranked.women.length, unranked.men.length); index++)
      ordered.push({
        id: `unranked-${index}`,
        rank: null,
        women: unranked.women[index] ? [unranked.women[index]!] : [],
        men: unranked.men[index] ? [unranked.men[index]!] : [],
      });
    result.set(position, ordered);
  }
  return result;
}
