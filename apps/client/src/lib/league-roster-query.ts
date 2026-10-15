// - Pin the direct competition relationship to avoid ambiguous REST embeddings
export const LEAGUE_ROSTER_SELECT =
  'id, fantasy_team_id, athlete_id, slot_code, status, athlete:athletes!roster_entries_athlete_id_fkey!inner(display_name, position, jersey_number, bio, competition:competitions!athletes_competition_id_fkey(name))';
