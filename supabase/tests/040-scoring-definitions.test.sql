begin;
select plan(24);

select is((select count(*)::integer from public.scoring_rules where ruleset_id = 'b0000000-0000-4000-8000-000000000004'), 30, 'new semantics retain all 30 coefficients');
select is((select count(*)::integer from public.scoring_rules v2 join public.scoring_rules v1 on v1.stat_key = v2.stat_key and v1.ruleset_id = 'b0000000-0000-4000-8000-000000000001' where v2.ruleset_id = 'b0000000-0000-4000-8000-000000000004' and v2.points is distinct from v1.points), 0, 'semantics revision does not change coefficients');
select is((select sum(points) from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000001', 'hockey', array['G'], '{"wins":1,"goals_allowed":0,"saves":25,"shutouts":1}')), 35::numeric, 'legacy frozen rules retain their original scoring contract');

select is((select sum(points) from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'hockey', array['G'], fixture.stats::jsonb)), fixture.expected, fixture.label)
from (values
  ('{"wins":1,"losses":0,"goals_allowed":0,"saves":25,"full_game_solo":1,"shootout":0}',35::numeric,'ordinary solo zero-GA game earns SO'),
  ('{"wins":1,"losses":0,"goals_allowed":2,"saves":25,"full_game_solo":1,"shootout":1}',31::numeric,'solo shootout winner earns W and SO with nonzero GA'),
  ('{"wins":0,"losses":1,"goals_allowed":2,"saves":25,"full_game_solo":1,"shootout":1}',21::numeric,'solo shootout loser earns SO and retains L without an invented loss coefficient'),
  ('{"wins":0,"losses":1,"goals_allowed":2,"saves":25,"full_game_solo":0,"shootout":1}',6::numeric,'shared shootout goalie receives no SO'),
  ('{"wins":0,"losses":0,"goals_allowed":0,"saves":25,"full_game_solo":0,"shootout":0}',10::numeric,'shared zero-GA goalie receives no SO'),
  ('{"wins":1,"losses":0,"goals_allowed":2,"saves":25,"full_game_solo":1,"shootout":0}',16::numeric,'ordinary goals against prevent SO')
) fixture(stats,expected,label);

select ok(exists(select 1 from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'hockey', array['G'], '{"wins":0,"losses":0,"goals_allowed":0,"saves":25,"shootout":0}') where not complete), 'missing full-game participation stays incomplete');
select throws_ok($test$ select * from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'hockey', array['G'], '{"wins":0,"losses":0,"goals_allowed":0,"saves":25,"full_game_solo":2,"shootout":0}') $test$, '22023', 'full_game_solo must be 0 or 1', 'full-game flag rejects invalid values');
select throws_ok($test$ select * from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'hockey', array['G'], '{"wins":1,"losses":1,"goals_allowed":0,"saves":25,"full_game_solo":1,"shootout":1}') $test$, '22023', 'A goalie cannot receive both a win and a loss', 'individual win and loss are exclusive');
select throws_ok($test$ select * from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'hockey', array['G'], '{"wins":0,"losses":0,"goals_allowed":0,"saves":25,"full_game_solo":0,"shootout":1,"shutouts":1}') $test$, '22023', 'Shutout credit conflicts with full-game solo participation', 'entered SO cannot override full-game rule');
select throws_ok($test$ select * from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'basketball', array['BC'], '{"points":0,"offensive_rebounds":0,"defensive_rebounds":0,"assists":0,"blocks":0,"steals":0,"turnovers":0,"fouls":0,"foul_out":2}') $test$, '22023', 'foul_out must be 0 or 1', 'scorekeeper FO is a binary flag');

select is((select sum(points) from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'volleyball', array['HT'], '{"kills":10,"aces":2,"solo_blocks":1,"assisted_blocks":2,"assists":40,"digs":8,"errors":15}')), 26.5::numeric, 'complete aggregate volleyball errors are accepted');
select throws_ok($test$ select * from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'volleyball', array['HT'], '{"kills":10,"aces":2,"solo_blocks":1,"assisted_blocks":2,"assists":40,"digs":8,"errors":1,"attack_errors":0,"service_errors":0,"reception_errors":0,"setting_errors":0,"ball_handling_errors":0,"blocking_errors":0}') $test$, '22023', 'Aggregate errors must equal all individual error categories', 'conflicting complete component and aggregate errors are rejected');
select is((select sum(points) from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'basketball', array['BC'], '{"points":0,"offensive_rebounds":0,"defensive_rebounds":0,"assists":0,"blocks":0,"steals":0,"turnovers":0,"fouls":5,"foul_out":0}')), -5::numeric, 'five fouls do not infer scorekeeper FO');
select is((select sum(points) from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'basketball', array['BC'], '{"points":0,"offensive_rebounds":0,"defensive_rebounds":0,"assists":0,"blocks":10,"steals":10,"turnovers":0,"fouls":0,"foul_out":0}')), 42::numeric, 'blocks and steals are eligible DD categories');

select is((select array_agg(scored.stat_value order by n) from generate_series(0,3) n cross join lateral beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'hockey', array['F'], jsonb_build_object('goals',n,'assists',0,'power_play_goals',0,'short_handed_goals',0,'penalty_minutes',0)) scored where scored.stat_key = 'skater.multi_point'), array[0,0,1,1]::numeric[], 'skater bonus boundary uses total goals and assists');
select is((select array_agg(scored.stat_value order by n) from generate_series(9,11) n cross join lateral beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'volleyball', array['HT'], jsonb_build_object('kills',n,'aces',0,'solo_blocks',0,'assisted_blocks',0,'assists',0,'digs',0,'errors',0)) scored where scored.stat_key = 'volleyball.hitter_bonus'), array[0,1,1]::numeric[], 'hitter threshold checked below at and above');
select is((select array_agg(scored.stat_value order by n) from generate_series(39,41) n cross join lateral beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'volleyball', array['S'], jsonb_build_object('kills',0,'aces',0,'solo_blocks',0,'assisted_blocks',0,'assists',n,'digs',0,'errors',0)) scored where scored.stat_key = 'volleyball.setter_bonus'), array[0,1,1]::numeric[], 'setter threshold checked below at and above');
select is((select array_agg(scored.stat_value order by n) from generate_series(7,9) n cross join lateral beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'volleyball', array['L'], jsonb_build_object('kills',0,'aces',0,'solo_blocks',0,'assisted_blocks',0,'assists',0,'digs',n,'errors',0)) scored where scored.stat_key = 'volleyball.libero_bonus'), array[0,1,1]::numeric[], 'libero threshold checked below at and above');
select is((select sum(points) from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'volleyball', array['HT'], '{"kills":0,"aces":0,"solo_blocks":0,"assisted_blocks":0,"assists":1,"digs":1,"errors":0}')), 0.5::numeric, 'quarter-point coefficients retain decimals');
select ok(not has_function_privilege('anon','beta_private.score_beta_stat_line_v2(uuid,public.sport_code,text[],jsonb)','EXECUTE'), 'new scoring function is not publicly executable');

select * from finish();
rollback;
