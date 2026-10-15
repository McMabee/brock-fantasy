-- Operator decisions R01-R04, including full-game solo precedence in all SO cases.
-- Version 1 is retained unchanged for any league already frozen to that ruleset.
-- No point event, historical snapshot or active league is rewritten by this migration.
alter function beta_private.score_beta_stat_line(uuid, public.sport_code, text[], jsonb)
  rename to score_beta_stat_line_v1;

create function beta_private.score_beta_stat_line_v2(
  p_ruleset_id uuid,
  p_sport public.sport_code,
  p_positions text[],
  p_stats jsonb
)
returns table(stat_key text, stat_value numeric, points numeric, complete boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  missing text[];
  goals numeric; assists numeric; power_play_goals numeric; short_handed_goals numeric; penalty_minutes numeric;
  wins numeric; losses numeric; full_game_solo numeric; shootout numeric; goals_allowed numeric; saves numeric; shutouts numeric;
  field record;
  scored_points numeric; offensive_rebounds numeric; defensive_rebounds numeric; basketball_assists numeric;
  blocks numeric; steals numeric; turnovers numeric; fouls numeric; foul_out numeric;
  kills numeric; aces numeric; solo_blocks numeric; assisted_blocks numeric; volleyball_assists numeric; digs numeric; errors numeric;
begin
  for field in select key, value from jsonb_each(p_stats) loop
    if jsonb_typeof(field.value) = 'number' then
      perform beta_private.stat_number(p_stats, field.key);
      if field.key = any(array['wins','losses','shutouts','full_game_solo','shootout','foul_out'])
        and (field.value::text)::numeric not in (0,1) then
        raise exception '% must be 0 or 1', field.key using errcode = '22023';
      end if;
    end if;
  end loop;
  if p_sport = 'hockey' and p_positions @> array['G'] then
    missing := beta_private.missing_stat_keys(p_stats, array['wins','losses','goals_allowed','saves','full_game_solo','shootout']);
    if cardinality(missing) > 0 then
      return query select '__missing__:' || array_to_string(missing, ','), 0::numeric, 0::numeric, false;
      return;
    end if;
    wins := beta_private.stat_number(p_stats, 'wins'); goals_allowed := beta_private.stat_number(p_stats, 'goals_allowed');
    saves := beta_private.stat_number(p_stats, 'saves');
    losses := beta_private.stat_number(p_stats, 'losses');
    full_game_solo := beta_private.stat_number(p_stats, 'full_game_solo');
    shootout := beta_private.stat_number(p_stats, 'shootout');
    if wins + losses > 1 then
      raise exception 'A goalie cannot receive both a win and a loss' using errcode = '22023';
    end if;
    shutouts := case when full_game_solo = 1 and (shootout = 1 or goals_allowed = 0) then 1 else 0 end;
    if p_stats ? 'shutouts' and jsonb_typeof(p_stats -> 'shutouts') = 'number'
      and beta_private.stat_number(p_stats, 'shutouts') <> shutouts then
      raise exception 'Shutout credit conflicts with full-game solo participation' using errcode = '22023';
    end if;
    return query values
      ('goalie.wins', wins, wins * beta_private.rule_points(p_ruleset_id, 'goalie.wins'), true),
      ('goalie.goals_allowed', goals_allowed, goals_allowed * beta_private.rule_points(p_ruleset_id, 'goalie.goals_allowed'), true),
      ('goalie.saves', saves, saves * beta_private.rule_points(p_ruleset_id, 'goalie.saves'), true),
      ('goalie.shutouts', shutouts, shutouts * beta_private.rule_points(p_ruleset_id, 'goalie.shutouts'), true);
    return;
  elsif p_sport = 'hockey' then
    missing := beta_private.missing_stat_keys(p_stats, array['goals','assists','power_play_goals','short_handed_goals','penalty_minutes']);
    if cardinality(missing) > 0 then
      return query select '__missing__:' || array_to_string(missing, ','), 0::numeric, 0::numeric, false;
      return;
    end if;
    goals := beta_private.stat_number(p_stats, 'goals'); assists := beta_private.stat_number(p_stats, 'assists');
    power_play_goals := beta_private.stat_number(p_stats, 'power_play_goals'); short_handed_goals := beta_private.stat_number(p_stats, 'short_handed_goals'); penalty_minutes := beta_private.stat_number(p_stats, 'penalty_minutes');
    return query values
      ('skater.goals', goals, goals * beta_private.rule_points(p_ruleset_id, 'skater.goals'), true),
      ('skater.assists', assists, assists * beta_private.rule_points(p_ruleset_id, 'skater.assists'), true),
      ('skater.power_play_goals', power_play_goals, power_play_goals * beta_private.rule_points(p_ruleset_id, 'skater.power_play_goals'), true),
      ('skater.short_handed_goals', short_handed_goals, short_handed_goals * beta_private.rule_points(p_ruleset_id, 'skater.short_handed_goals'), true),
      ('skater.penalty_minutes', penalty_minutes, penalty_minutes * beta_private.rule_points(p_ruleset_id, 'skater.penalty_minutes'), true),
      ('skater.multi_point', case when goals + assists >= 2 then 1 else 0 end, case when goals + assists >= 2 then beta_private.rule_points(p_ruleset_id, 'skater.multi_point') else 0 end, true);
    return;
  elsif p_sport = 'basketball' then
    missing := beta_private.missing_stat_keys(p_stats, array['points','offensive_rebounds','defensive_rebounds','assists','blocks','steals','turnovers','fouls','foul_out']);
    if cardinality(missing) > 0 then
      return query select '__missing__:' || array_to_string(missing, ','), 0::numeric, 0::numeric, false;
      return;
    end if;
    scored_points := beta_private.stat_number(p_stats, 'points'); offensive_rebounds := beta_private.stat_number(p_stats, 'offensive_rebounds');
    defensive_rebounds := beta_private.stat_number(p_stats, 'defensive_rebounds'); basketball_assists := beta_private.stat_number(p_stats, 'assists');
    blocks := beta_private.stat_number(p_stats, 'blocks'); steals := beta_private.stat_number(p_stats, 'steals'); turnovers := beta_private.stat_number(p_stats, 'turnovers'); fouls := beta_private.stat_number(p_stats, 'fouls'); foul_out := beta_private.stat_number(p_stats, 'foul_out');
    return query values
      ('basketball.points', scored_points, scored_points * beta_private.rule_points(p_ruleset_id, 'basketball.points'), true),
      ('basketball.offensive_rebounds', offensive_rebounds, offensive_rebounds * beta_private.rule_points(p_ruleset_id, 'basketball.offensive_rebounds'), true),
      ('basketball.defensive_rebounds', defensive_rebounds, defensive_rebounds * beta_private.rule_points(p_ruleset_id, 'basketball.defensive_rebounds'), true),
      ('basketball.assists', basketball_assists, basketball_assists * beta_private.rule_points(p_ruleset_id, 'basketball.assists'), true),
      ('basketball.blocks', blocks, blocks * beta_private.rule_points(p_ruleset_id, 'basketball.blocks'), true),
      ('basketball.steals', steals, steals * beta_private.rule_points(p_ruleset_id, 'basketball.steals'), true),
      ('basketball.turnovers', turnovers, turnovers * beta_private.rule_points(p_ruleset_id, 'basketball.turnovers'), true),
      ('basketball.fouls', fouls, fouls * beta_private.rule_points(p_ruleset_id, 'basketball.fouls'), true),
      ('basketball.foul_out', foul_out, foul_out * beta_private.rule_points(p_ruleset_id, 'basketball.foul_out'), true),
      ('basketball.double_double', case when (case when scored_points >= 10 then 1 else 0 end + case when offensive_rebounds + defensive_rebounds >= 10 then 1 else 0 end + case when basketball_assists >= 10 then 1 else 0 end + case when steals >= 10 then 1 else 0 end + case when blocks >= 10 then 1 else 0 end) >= 2 then 1 else 0 end, case when (case when scored_points >= 10 then 1 else 0 end + case when offensive_rebounds + defensive_rebounds >= 10 then 1 else 0 end + case when basketball_assists >= 10 then 1 else 0 end + case when steals >= 10 then 1 else 0 end + case when blocks >= 10 then 1 else 0 end) >= 2 then beta_private.rule_points(p_ruleset_id, 'basketball.double_double') else 0 end, true);
    return;
  elsif p_sport = 'volleyball' then
    missing := beta_private.missing_stat_keys(p_stats, array['kills','aces','solo_blocks','assisted_blocks','assists','digs']);
    if coalesce(jsonb_typeof(p_stats -> 'errors'), '') <> 'number' then
      missing := missing || beta_private.missing_stat_keys(p_stats, array['attack_errors','service_errors','reception_errors','setting_errors','ball_handling_errors','blocking_errors']);
    end if;
    if cardinality(missing) > 0 then
      return query select '__missing__:' || array_to_string(missing, ','), 0::numeric, 0::numeric, false;
      return;
    end if;
    kills := beta_private.stat_number(p_stats, 'kills'); aces := beta_private.stat_number(p_stats, 'aces'); solo_blocks := beta_private.stat_number(p_stats, 'solo_blocks'); assisted_blocks := beta_private.stat_number(p_stats, 'assisted_blocks'); volleyball_assists := beta_private.stat_number(p_stats, 'assists'); digs := beta_private.stat_number(p_stats, 'digs');
    if cardinality(beta_private.missing_stat_keys(p_stats, array['attack_errors','service_errors','reception_errors','setting_errors','ball_handling_errors','blocking_errors'])) = 0 then
      errors := beta_private.stat_number(p_stats, 'attack_errors') + beta_private.stat_number(p_stats, 'service_errors') + beta_private.stat_number(p_stats, 'reception_errors') + beta_private.stat_number(p_stats, 'setting_errors') + beta_private.stat_number(p_stats, 'ball_handling_errors') + beta_private.stat_number(p_stats, 'blocking_errors');
      if jsonb_typeof(p_stats -> 'errors') = 'number' and beta_private.stat_number(p_stats, 'errors') <> errors then
        raise exception 'Aggregate errors must equal all individual error categories' using errcode = '22023';
      end if;
    else
      errors := beta_private.stat_number(p_stats, 'errors');
    end if;
    return query values
      ('volleyball.kills', kills, kills * beta_private.rule_points(p_ruleset_id, 'volleyball.kills'), true),
      ('volleyball.aces', aces, aces * beta_private.rule_points(p_ruleset_id, 'volleyball.aces'), true),
      ('volleyball.solo_blocks', solo_blocks, solo_blocks * beta_private.rule_points(p_ruleset_id, 'volleyball.solo_blocks'), true),
      ('volleyball.assisted_blocks', assisted_blocks, assisted_blocks * beta_private.rule_points(p_ruleset_id, 'volleyball.assisted_blocks'), true),
      ('volleyball.assists', volleyball_assists, volleyball_assists * beta_private.rule_points(p_ruleset_id, 'volleyball.assists'), true),
      ('volleyball.digs', digs, digs * beta_private.rule_points(p_ruleset_id, 'volleyball.digs'), true),
      ('volleyball.errors', errors, errors * beta_private.rule_points(p_ruleset_id, 'volleyball.errors'), true),
      ('volleyball.hitter_bonus', case when p_positions && array['HT'] and kills >= 10 then 1 else 0 end, case when p_positions && array['HT'] and kills >= 10 then beta_private.rule_points(p_ruleset_id, 'volleyball.hitter_bonus') else 0 end, true),
      ('volleyball.setter_bonus', case when p_positions && array['S'] and volleyball_assists >= 40 then 1 else 0 end, case when p_positions && array['S'] and volleyball_assists >= 40 then beta_private.rule_points(p_ruleset_id, 'volleyball.setter_bonus') else 0 end, true),
      ('volleyball.libero_bonus', case when p_positions && array['L'] and digs >= 8 then 1 else 0 end, case when p_positions && array['L'] and digs >= 8 then beta_private.rule_points(p_ruleset_id, 'volleyball.libero_bonus') else 0 end, true);
    return;
  end if;
  raise exception 'Unsupported sport %', p_sport using errcode = '22023';
end;
$$;


create function beta_private.score_beta_stat_line(
  p_ruleset_id uuid, p_sport public.sport_code, p_positions text[], p_stats jsonb
)
returns table(stat_key text, stat_value numeric, points numeric, complete boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if exists(select 1 from public.scoring_rulesets
    where id = p_ruleset_id and matchup_config ->> 'scoringSemantics' = 'brock-2026.2') then
    return query select * from beta_private.score_beta_stat_line_v2(p_ruleset_id, p_sport, p_positions, p_stats);
  else
    return query select * from beta_private.score_beta_stat_line_v1(p_ruleset_id, p_sport, p_positions, p_stats);
  end if;
end;
$$;

revoke all on function beta_private.score_beta_stat_line_v1(uuid, public.sport_code, text[], jsonb) from public, anon, authenticated, service_role;
revoke all on function beta_private.score_beta_stat_line_v2(uuid, public.sport_code, text[], jsonb) from public, anon, authenticated, service_role;
revoke all on function beta_private.score_beta_stat_line(uuid, public.sport_code, text[], jsonb) from public, anon, authenticated, service_role;

-- The coefficients and roster/transaction settings remain unchanged. This version
-- records the operator-confirmed semantics; approved_at is the recording time.
insert into public.scoring_rulesets(id,sport,name,version,status,approved_at,draft_config,transaction_config,matchup_config)
select 'b0000000-0000-4000-8000-000000000004',sport,'Brock combined 2026.2',2,'approved',now(),
  draft_config,transaction_config,matchup_config || jsonb_build_object(
    'scoringSemantics','brock-2026.2','definitionRevision','operator-beta-definitions-2026-10-06',
    'approvalReference','docs/evidence/2026-10-06-beta-decisions.json')
from public.scoring_rulesets where id = 'b0000000-0000-4000-8000-000000000001';

insert into public.scoring_rules(ruleset_id,stat_key,label,points,sort_order)
select 'b0000000-0000-4000-8000-000000000004',stat_key,label,points,sort_order
from public.scoring_rules where ruleset_id = 'b0000000-0000-4000-8000-000000000001';
insert into public.roster_slot_rules(ruleset_id,slot_code,label,allowed_positions,slot_count,is_starter)
select 'b0000000-0000-4000-8000-000000000004',slot_code,label,allowed_positions,slot_count,is_starter
from public.roster_slot_rules where ruleset_id = 'b0000000-0000-4000-8000-000000000001';

-- Change only the still-inactive, unused default pool. Existing leagues retain v1.
do $$
begin
  if exists(select 1 from public.player_pools where id = 'b0000000-0000-4000-8000-000000000003' and is_active)
    or exists(select 1 from public.leagues where pool_id = 'b0000000-0000-4000-8000-000000000003') then
    raise exception 'Default pool already in use; create a reviewed version-2 pool instead of migrating its rules';
  end if;
end;
$$;
update public.player_pools set ruleset_id = 'b0000000-0000-4000-8000-000000000004', state_version = state_version + 1
where id = 'b0000000-0000-4000-8000-000000000003';
update public.fantasy_seasons set rule_version = 'brock-2026.2'
where id = 'b0000000-0000-4000-8000-000000000002' and status = 'draft';
