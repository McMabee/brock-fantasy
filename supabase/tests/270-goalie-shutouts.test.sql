begin;
select plan(6);

select is((select sum(points) from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'hockey', array['G'], '{"wins":1,"losses":0,"goals_allowed":0,"saves":25,"full_game_solo":1,"shutouts":1}')),35::numeric,'admin shutout field scores without a shootout field');
select is((select sum(points) from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'hockey', array['G'], '{"wins":1,"losses":0,"goals_allowed":2,"saves":25,"full_game_solo":1,"shutouts":0}')),16::numeric,'admin non-shutout field scores without a shootout field');
select is((select sum(points) from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'hockey', array['G'], '{"wins":1,"losses":0,"goals_allowed":0,"saves":25,"full_game_solo":1}')),35::numeric,'older lines infer shutout credit from participation and goals allowed');
select throws_ok($test$ select * from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'hockey', array['G'], '{"wins":1,"losses":0,"goals_allowed":2,"saves":25,"full_game_solo":1,"shutouts":1}') $test$,'22023','Shutout flag must match zero goals allowed and full-game solo participation','shutout cannot be credited when goals were allowed');
select throws_ok($test$ select * from beta_private.score_beta_stat_line('b0000000-0000-4000-8000-000000000004', 'hockey', array['G'], '{"wins":1,"losses":0,"goals_allowed":0,"saves":25,"full_game_solo":1,"shutouts":0}') $test$,'22023','Shutout flag must match zero goals allowed and full-game solo participation','contradictory shutout flag requires correction');
select ok(not has_function_privilege('authenticated','beta_private.score_beta_stat_line_v2(uuid,public.sport_code,text[],jsonb)','EXECUTE'),'scoring remains private');

select * from finish();
rollback;
