import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// - Run through real local Auth sessions and PostgREST without starting a hosted user draft
export async function testLateDraft({ sql, rpc, q, proveUpgrade }) {
  await sql(`begin;
    delete from public.roster_slot_history where roster_entry_id in(select id from public.roster_entries where league_id=pg_temp.m_id('league'));
    delete from public.roster_entries where league_id=pg_temp.m_id('league');
    delete from public.drafts where league_id=pg_temp.m_id('league');
    update public.leagues set status='setup' where id=pg_temp.m_id('league');
    update public.player_pools set rankings_approved_at=now() where id=pg_temp.m_id('pool');
    insert into public.pool_competitions(pool_id,competition_id) values(pg_temp.m_id('pool'),pg_temp.m_id('competition'));
    insert into public.athletes(id,competition_id,team_id,display_name,position)
    select pg_temp.m_id('reserve'||n),pg_temp.m_id('competition'),pg_temp.m_id('program'),'Late draft fixture '||n,'F' from generate_series(1,44)n;
    insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)
    select pg_temp.m_id('reserve'||n),pg_temp.m_id('season'),pg_temp.m_id('competition'),pg_temp.m_id('program'),array['F','D','G','BC','FC','HT','L','S'],true,true from generate_series(1,44)n;
    insert into public.pool_rankings(pool_id,athlete_id,rank,reviewed,basis)
    select pg_temp.m_id('pool'),athlete_id,row_number() over(order by athlete_id),true,'Reviewed local late-draft fixture'
    from public.athlete_seasons where season_id=pg_temp.m_id('season');commit;`);
  const league = await sql("select pg_temp.m_id('league');");
  const version = Number(
    await sql(`select state_version from public.leagues where id=${q(league)};`),
  );
  const scheduledFor = new Date(Date.now() + 3600000).toISOString();
  const start = {
    p_league_id: league,
    p_rounds: 10,
    p_pick_seconds: 120,
    p_idempotency_key: 'late-start-' + league,
  };
  const schedule = {
    p_league_id: league,
    p_scheduled_for: scheduledFor,
    p_expected_version: version,
    p_idempotency_key: 'late-schedule-' + league,
  };
  async function expect(name, payload, status, message, index = 0) {
    const response = await rpc(name, payload, index);
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    if (message) assert.equal(body.message, message);
    return body;
  }
  if (proveUpgrade) {
    await expect('start_draft', start, 400, 'The season has started');
    await expect(
      'schedule_league_draft',
      schedule,
      400,
      'Choose a future date before the season starts',
    );
    const migration = await readFile(
      'supabase/migrations/20261024170758_allow_late_league_drafts.sql',
      'utf8',
    );
    await sql('begin;' + migration + 'commit;');
    console.log('PASS reproduced both preseason HTTP 400 errors before the migration');
  }
  await expect(
    'schedule_league_draft',
    { ...schedule, p_idempotency_key: 'member-' + league },
    403,
    'Commissioner access required',
    1,
  );
  await expect(
    'start_draft',
    { ...start, p_idempotency_key: 'member-start-' + league },
    400,
    'Commissioner access required',
    1,
  );
  await expect(
    'start_draft',
    { ...start, p_rounds: 9, p_idempotency_key: 'wrong-rounds-' + league },
    400,
    'Draft requires ten rounds and the saved pick duration',
  );
  const stale = await expect(
    'schedule_league_draft',
    { ...schedule, p_expected_version: -1, p_idempotency_key: 'stale-' + league },
    409,
    'League changed; refresh and retry',
  );
  assert.equal(stale.code, 'PT409');
  await expect(
    'schedule_league_draft',
    {
      ...schedule,
      p_scheduled_for: new Date(Date.now() - 60000).toISOString(),
      p_idempotency_key: 'past-' + league,
    },
    400,
    'Choose a future date while an eligible regular-season period remains',
  );
  await expect('schedule_league_draft', schedule, 200);
  const started = await expect('start_draft', start, 200);
  const duplicate = await expect('start_draft', start, 200);
  assert.equal(duplicate.draft_id, started.draft_id);
  assert.equal(await sql(`select count(*) from public.drafts where league_id=${q(league)};`), '1');
  assert.equal(
    await sql(`select count(*) from public.matchups where league_id=${q(league)};`),
    '0',
  );
  console.log(
    'PASS late schedule/start over real HTTP, authorization, stale 409, date/round guards, idempotent retry and zero matchups before draft completion',
  );
}
