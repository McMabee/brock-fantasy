begin;
select plan(25);

select has_table('public', 'fantasy_seasons', 'beta season catalog exists');
select has_table('public', 'athlete_seasons', 'season memberships exist');
select has_table('public', 'fantasy_periods', 'explicit fantasy periods exist');
select has_table('public', 'source_imports', 'source provenance imports exist');
select has_table('public', 'weekly_projections', 'projection records exist');
select has_table('public', 'period_lineup_locks', 'individual player locks exist');

select is(
  (select count(*)::integer from public.scoring_rules where ruleset_id = 'b0000000-0000-4000-8000-000000000001'),
  30,
  'every supplied scoring coefficient is versioned'
);
select is(
  (select points from public.scoring_rules where ruleset_id = 'b0000000-0000-4000-8000-000000000001' and stat_key = 'skater.goals'),
  20::numeric,
  'hockey goal coefficient is preserved'
);
select is(
  (select points from public.scoring_rules where ruleset_id = 'b0000000-0000-4000-8000-000000000001' and stat_key = 'volleyball.errors'),
  -1::numeric,
  'volleyball error coefficient is preserved'
);
select is(
  (select count(*)::integer from public.fantasy_periods where season_id = 'b0000000-0000-4000-8000-000000000002'),
  10,
  'all ten explicit periods are stored'
);
select is(
  (select starts_at from public.fantasy_periods where season_id = 'b0000000-0000-4000-8000-000000000002' and number = 2),
  '2026-11-01T04:00:00Z'::timestamptz,
  'Toronto DST boundary is stored in UTC'
);
select is(
  (select count(*)::integer from public.roster_slot_rules where ruleset_id = 'b0000000-0000-4000-8000-000000000001'),
  7,
  'six starters plus a four-place bench are configured'
);

select is(
  (select sum(points) from beta_private.score_beta_stat_line(
    'b0000000-0000-4000-8000-000000000001', 'hockey', array['F'],
    '{"goals":1,"assists":1,"power_play_goals":1,"short_handed_goals":0,"penalty_minutes":2}'::jsonb
  )),
  38::numeric,
  'hockey multi-point and power-play bonuses are additive'
);
select is(
  (select sum(points) from beta_private.score_beta_stat_line(
    'b0000000-0000-4000-8000-000000000001', 'hockey', array['G'],
    '{"wins":1,"goals_allowed":0,"saves":25,"shutouts":1}'::jsonb
  )),
  35::numeric,
  'goalie win and shutout require individually supplied values'
);
select is(
  (select sum(points) from beta_private.score_beta_stat_line(
    'b0000000-0000-4000-8000-000000000001', 'basketball', array['BC'],
    '{"points":10,"offensive_rebounds":2,"defensive_rebounds":8,"assists":10,"blocks":1,"steals":2,"turnovers":3,"fouls":5,"foul_out":1}'::jsonb
  )),
  25::numeric,
  'basketball uses total rebounds, one double-double, and additive foul-out deduction'
);
select is(
  (select sum(points) from beta_private.score_beta_stat_line(
    'b0000000-0000-4000-8000-000000000001', 'volleyball', array['HT'],
    '{"kills":10,"aces":2,"solo_blocks":1,"assisted_blocks":2,"assists":40,"digs":8,"attack_errors":1,"service_errors":2,"reception_errors":3,"setting_errors":0,"ball_handling_errors":4,"blocking_errors":5,"errors":15}'::jsonb
  )),
  26.5::numeric,
  'volleyball uses all individual error categories without double-counting aggregate errors'
);
select is(
  (select sum(points) from beta_private.score_beta_stat_line(
    'b0000000-0000-4000-8000-000000000001', 'volleyball', array['L'],
    '{"kills":10,"aces":2,"solo_blocks":1,"assisted_blocks":2,"assists":40,"digs":8,"attack_errors":1,"service_errors":2,"reception_errors":3,"setting_errors":0,"ball_handling_errors":4,"blocking_errors":5}'::jsonb
  )),
  32.5::numeric,
  'libero bonus uses the position-specific dig threshold'
);
select ok(
  exists(select 1 from beta_private.score_beta_stat_line(
    'b0000000-0000-4000-8000-000000000001', 'hockey', array['G'],
    '{"goals_allowed":0,"saves":25}'::jsonb
  ) where not complete),
  'missing goalie credits remain incomplete rather than being inferred'
);
select ok(
  exists(select 1 from beta_private.score_beta_stat_line(
    'b0000000-0000-4000-8000-000000000001', 'volleyball', array['HT'],
    '{"kills":10,"aces":2,"solo_blocks":1,"assisted_blocks":2,"assists":40,"digs":8,"attack_errors":1,"service_errors":2,"reception_errors":3,"setting_errors":0,"ball_handling_errors":4}'::jsonb
  ) where not complete),
  'missing volleyball error categories remain incomplete'
);
select has_function('public', 'preview_game_revision', array['uuid','bigint','jsonb'], 'admin score previews are read-only commands');
select has_function('public', 'vote_trade', array['uuid','text'], 'beta trade veto voting command exists');
select has_function('public', 'process_due_trades', array['uuid','integer'], 'beta trade review worker exists');
select ok(has_function_privilege('service_role', 'public.process_due_trades(uuid,integer)', 'EXECUTE'), 'service role can settle reviewed beta trades');
select has_function('public', 'mark_notification_read', array['uuid','text'], 'notification reads use a trusted command');
select ok(has_function_privilege('authenticated', 'public.mark_notification_read(uuid,text)', 'EXECUTE'), 'authenticated users can mark their own notifications read');

select * from finish();
rollback;
