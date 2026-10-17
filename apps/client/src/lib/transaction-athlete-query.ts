export const TRANSACTION_ATHLETE_SELECT =
  'id,display_name,position,bio,competition:competitions!athletes_competition_id_fkey(name),team:teams!athletes_team_id_fkey(name)';
