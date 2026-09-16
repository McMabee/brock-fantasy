-- Synthetic local-development configuration only. These rules are intentionally
-- left in DRAFT state and competitions inactive so they cannot be mistaken for
-- stakeholder-approved production scoring.
insert into public.sports (id, code, name) values
  ('00000000-0000-4000-8000-000000000001', 'hockey', 'Hockey'),
  ('00000000-0000-4000-8000-000000000002', 'basketball', 'Basketball'),
  ('00000000-0000-4000-8000-000000000003', 'volleyball', 'Volleyball')
on conflict do nothing;

insert into public.scoring_rulesets (
  id, sport, name, version, status, draft_config, transaction_config, matchup_config
) values
  (
    '10000000-0000-4000-8000-000000000001', 'hockey', 'SYNTHETIC Hockey', 1, 'draft',
    '{"pickSeconds":90,"autopickStrategy":"queued_then_ranked_legal"}',
    '{"freeAgentsEnabled":true,"waiversEnabled":true,"tradesEnabled":true,"waiverProcessHourUtc":12}',
    '{"periodDays":7,"tiesAllowed":true,"tiebreaker":"points_for"}'
  ),
  (
    '10000000-0000-4000-8000-000000000002', 'basketball', 'SYNTHETIC Basketball', 1, 'draft',
    '{"pickSeconds":90,"autopickStrategy":"queued_then_ranked_legal"}',
    '{"freeAgentsEnabled":true,"waiversEnabled":true,"tradesEnabled":true,"waiverProcessHourUtc":12}',
    '{"periodDays":7,"tiesAllowed":true,"tiebreaker":"points_for"}'
  ),
  (
    '10000000-0000-4000-8000-000000000003', 'volleyball', 'SYNTHETIC Volleyball', 1, 'draft',
    '{"pickSeconds":90,"autopickStrategy":"queued_then_ranked_legal"}',
    '{"freeAgentsEnabled":true,"waiversEnabled":true,"tradesEnabled":true,"waiverProcessHourUtc":12}',
    '{"periodDays":7,"tiesAllowed":true,"tiebreaker":"points_for"}'
  )
on conflict do nothing;

insert into public.scoring_rules (ruleset_id, stat_key, label, points, sort_order) values
  ('10000000-0000-4000-8000-000000000001', 'goals', 'Goals', 3, 1),
  ('10000000-0000-4000-8000-000000000001', 'assists', 'Assists', 2, 2),
  ('10000000-0000-4000-8000-000000000001', 'shots', 'Shots', 0.5, 3),
  ('10000000-0000-4000-8000-000000000002', 'points', 'Points', 1, 1),
  ('10000000-0000-4000-8000-000000000002', 'rebounds', 'Rebounds', 1.2, 2),
  ('10000000-0000-4000-8000-000000000002', 'assists', 'Assists', 1.5, 3),
  ('10000000-0000-4000-8000-000000000003', 'kills', 'Kills', 1, 1),
  ('10000000-0000-4000-8000-000000000003', 'aces', 'Aces', 2, 2),
  ('10000000-0000-4000-8000-000000000003', 'blocks', 'Blocks', 1.5, 3)
on conflict do nothing;

insert into public.roster_slot_rules (ruleset_id, slot_code, label, allowed_positions, slot_count, is_starter) values
  ('10000000-0000-4000-8000-000000000001', 'F1', 'Forward 1', array['F'], 1, true),
  ('10000000-0000-4000-8000-000000000001', 'F2', 'Forward 2', array['F'], 1, true),
  ('10000000-0000-4000-8000-000000000001', 'D1', 'Defence 1', array['D'], 1, true),
  ('10000000-0000-4000-8000-000000000001', 'G1', 'Goalie 1', array['G'], 1, true),
  ('10000000-0000-4000-8000-000000000001', 'BN', 'Bench', array['F','D','G'], 4, false),
  ('10000000-0000-4000-8000-000000000002', 'G1', 'Guard 1', array['G'], 1, true),
  ('10000000-0000-4000-8000-000000000002', 'F1', 'Forward 1', array['F'], 1, true),
  ('10000000-0000-4000-8000-000000000002', 'C1', 'Centre 1', array['C'], 1, true),
  ('10000000-0000-4000-8000-000000000002', 'FLEX1', 'Flex 1', array['G','F','C'], 1, true),
  ('10000000-0000-4000-8000-000000000002', 'FLEX2', 'Flex 2', array['G','F','C'], 1, true),
  ('10000000-0000-4000-8000-000000000002', 'BN', 'Bench', array['G','F','C'], 4, false),
  ('10000000-0000-4000-8000-000000000003', 'S1', 'Setter', array['S'], 1, true),
  ('10000000-0000-4000-8000-000000000003', 'OH1', 'Outside Hitter', array['OH'], 1, true),
  ('10000000-0000-4000-8000-000000000003', 'MB1', 'Middle Blocker', array['MB'], 1, true),
  ('10000000-0000-4000-8000-000000000003', 'L1', 'Libero', array['L'], 1, true),
  ('10000000-0000-4000-8000-000000000003', 'BN', 'Bench', array['S','OH','OPP','MB','L'], 4, false)
on conflict do nothing;

insert into public.competitions (
  id, sport_id, division, name, season_label, ruleset_id, is_active
) values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'mens', 'Men''s Hockey', '2026-27', '10000000-0000-4000-8000-000000000001', false),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'womens', 'Women''s Hockey', '2026-27', '10000000-0000-4000-8000-000000000001', false),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'mens', 'Men''s Basketball', '2026-27', '10000000-0000-4000-8000-000000000002', false),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', 'womens', 'Women''s Basketball', '2026-27', '10000000-0000-4000-8000-000000000002', false),
  ('20000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', 'mens', 'Men''s Volleyball', '2026-27', '10000000-0000-4000-8000-000000000003', false),
  ('20000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000003', 'womens', 'Women''s Volleyball', '2026-27', '10000000-0000-4000-8000-000000000003', false)
on conflict do nothing;
