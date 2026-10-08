import type { RequestHandler } from 'expo-router/server';

import { actor, apiConfig, isAdmin, json } from '@/server/session';

interface RestRow {
  id: string;
  [key: string]: unknown;
}

function sportCode(row: RestRow | undefined): string | null {
  const relation: unknown = row?.sport;
  const sport: unknown = Array.isArray(relation) ? (relation as readonly unknown[])[0] : relation;
  if (!sport || typeof sport !== 'object') return null;
  const code = (sport as Record<string, unknown>).code;
  return typeof code === 'string' ? code : null;
}

async function adminActor(request: Request) {
  const current = await actor(request);
  return current && current.aal === 'aal2' && (await isAdmin(current)) ? current : null;
}

async function rest<T>(path: string, accessToken: string): Promise<T | null> {
  const config = apiConfig();
  if (!config) return null;
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: { apikey: config.key, authorization: `Bearer ${accessToken}` },
  });
  return response.ok ? ((await response.json()) as T) : null;
}

function list(value: string[]): string {
  return `in.(${value.map((item) => encodeURIComponent(item)).join(',')})`;
}

async function withTeams(games: RestRow[], accessToken: string): Promise<RestRow[] | null> {
  const teamIds = [
    ...new Set(
      games
        .flatMap((game) => [game.home_team_id, game.away_team_id])
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
  const teams = teamIds.length
    ? await rest<RestRow[]>(`teams?id=${list(teamIds)}&select=id,name,short_name`, accessToken)
    : [];
  if (!teams) return null;
  const byTeam = new Map(
    teams.map((team) => [team.id, { name: team.name, shortName: team.short_name }]),
  );
  return games.map((game) => ({
    ...game,
    home: byTeam.get(String(game.home_team_id)) ?? null,
    away: byTeam.get(String(game.away_team_id)) ?? null,
  }));
}

export const GET: RequestHandler = async (request) => {
  const current = await adminActor(request);
  if (!current) return json({ error: 'Administrator AAL2 access is required.' }, 403);
  const gameId = new URL(request.url).searchParams.get('gameId');
  if (gameId && !/^[0-9a-f-]{36}$/iu.test(gameId)) return json({ error: 'Invalid game.' }, 400);
  if (gameId) {
    const [games, stats] = await Promise.all([
      rest<RestRow[]>(
        `games?id=eq.${encodeURIComponent(gameId)}&select=id,competition_id,home_team_id,away_team_id,starts_at,status,home_score,away_score,state_version,stats_complete,manual_override,source_updated_at`,
        current.accessToken,
      ),
      rest<RestRow[]>(
        `normalized_player_game_stats?game_id=eq.${encodeURIComponent(gameId)}&select=athlete_id,stats,fantasy_points,complete,missing_stats,updated_at`,
        current.accessToken,
      ),
    ]);
    if (!games || !stats)
      return json({ error: 'Game details are unavailable. No revision was loaded.' }, 503);
    const game = games?.[0];
    const [athletes, competitions, enrichedGames] = game
      ? await Promise.all([
          rest<RestRow[]>(
            `athletes?competition_id=eq.${encodeURIComponent(String(game.competition_id))}&status=eq.active&select=id,display_name,position,jersey_number&order=display_name`,
            current.accessToken,
          ),
          rest<RestRow[]>(
            `competitions?id=eq.${encodeURIComponent(String(game.competition_id))}&select=id,sport:sports!inner(code)`,
            current.accessToken,
          ),
          withTeams(games, current.accessToken),
        ])
      : [[], [], []];
    if (!athletes || !competitions || !enrichedGames)
      return json({ error: 'Game details are unavailable. No revision was loaded.' }, 503);
    return game
      ? json({
          game: enrichedGames[0],
          stats: stats ?? [],
          athletes: athletes ?? [],
          sport: sportCode(competitions?.[0]),
        })
      : json({ error: 'Game not found.' }, 404);
  }
  const games = await rest<RestRow[]>(
    'games?select=id,competition_id,home_team_id,away_team_id,starts_at,status,home_score,away_score,state_version,stats_complete,manual_override,source_updated_at&order=starts_at.desc&limit=200',
    current.accessToken,
  );
  if (!games) return json({ error: 'Game search is unavailable.' }, 503);
  const enrichedGames = await withTeams(games, current.accessToken);
  return enrichedGames
    ? json({ games: enrichedGames })
    : json({ error: 'Game search is unavailable.' }, 503);
};
