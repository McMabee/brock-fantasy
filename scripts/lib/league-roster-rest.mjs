import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { LEAGUE_ROSTER_SELECT } from '../../apps/client/src/lib/league-roster-query.ts';

const exec = promisify(execFile);

export async function verifyLeagueRosterRest({ database, databaseContainer, executeSql }) {
  assert.match(database, /^bf_registration_[a-z0-9_]+$/u);
  assert.match(databaseContainer, /^supabase_db_[a-zA-Z0-9_-]+$/u);
  const ids = Object.fromEntries(
    ['user', 'session', 'competition', 'team', 'athlete', 'league', 'fantasyTeam'].map((key) => [
      key,
      randomUUID(),
    ]),
  );
  const container = `bf-roster-rest-${randomUUID()}`;
  const secret = randomBytes(32).toString('base64url');
  let created = false;
  try {
    await executeSql(`
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
values('${ids.user}','roster-rest@example.test',now(),jsonb_build_object('display_name','REST fixture','beta_age_eligible',true,
 'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::integer,
 'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1'),now(),now());
insert into auth.sessions(id,user_id,aal) values('${ids.session}','${ids.user}','aal1');
insert into public.sports(code,name) values('hockey','Hockey') on conflict(code) do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id,is_active)
select '${ids.competition}',id,'mens','Brock Men''s Hockey','2026-27','b0000000-0000-4000-8000-000000000004',true from public.sports where code='hockey';
insert into public.teams(id,competition_id,name,short_name,is_brock) values('${ids.team}','${ids.competition}','Brock','BRO',true);
insert into public.athletes(id,competition_id,team_id,display_name,position,bio)
values('${ids.athlete}','${ids.competition}','${ids.team}','REST athlete','F','{"program":"mens_hockey"}');
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)
values('${ids.athlete}','b0000000-0000-4000-8000-000000000002','${ids.competition}','${ids.team}',array['F'],true,true);
insert into public.pool_competitions(pool_id,competition_id) values('b0000000-0000-4000-8000-000000000003','${ids.competition}');
update public.player_pools set is_active=true where id='b0000000-0000-4000-8000-000000000003';
insert into public.leagues(id,pool_id,ruleset_id,commissioner_id,name,invite_code,max_members,format)
values('${ids.league}','b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000004','${ids.user}','REST league','roster-rest',4,'head_to_head');
insert into public.league_members(league_id,user_id,role) values('${ids.league}','${ids.user}','commissioner');
insert into public.fantasy_teams(id,league_id,owner_id,name) values('${ids.fantasyTeam}','${ids.league}','${ids.user}','REST team');
insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type)
values('${ids.league}','${ids.fantasyTeam}','${ids.athlete}','HK_F','starter','draft');
insert into public.athlete_season_summaries(athlete_id,season_label,source,kind,fantasy_points,games_played,supplied_adp)
values('${ids.athlete}','2026-27','REST fixture','supplied_projection',100,20,12.5);
`);
    const networkInfo = await exec(
      'docker',
      ['inspect', databaseContainer, '--format', '{{json .NetworkSettings.Networks}}'],
      { windowsHide: true },
    );
    const network = Object.keys(JSON.parse(networkInfo.stdout))[0];
    assert.ok(network);
    await exec(
      'docker',
      [
        'run',
        '--detach',
        '--name',
        container,
        '--network',
        network,
        '-p',
        '127.0.0.1::3000',
        '-e',
        `PGRST_DB_URI=postgresql://postgres:postgres@${databaseContainer}:5432/${database}`,
        '-e',
        'PGRST_DB_SCHEMAS=public',
        '-e',
        'PGRST_DB_ANON_ROLE=anon',
        '-e',
        `PGRST_JWT_SECRET=${secret}`,
        'public.ecr.aws/supabase/postgrest:v16.2',
      ],
      { windowsHide: true },
    );
    created = true;
    const portResult = await exec('docker', ['port', container, '3000/tcp'], { windowsHide: true });
    const port = /^127\.0\.0\.1:(\d+)$/u.exec(portResult.stdout.trim())?.[1];
    assert.ok(port);
    const origin = `http://127.0.0.1:${port}`;
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'authenticated', sub: ids.user, session_id: ids.session, aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 300 })}`;
    const token = `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await fetch(origin, { signal: AbortSignal.timeout(500) }).catch(() => null);
      if (response?.status === 200) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Disposable REST server is ready');
    const query = new URLSearchParams({
      select: 'id,athlete:athletes!inner(display_name,competition:competitions(name))',
      fantasy_team_id: `eq.${ids.fantasyTeam}`,
      released_at: 'is.null',
    });
    const ambiguous = await fetch(`${origin}/roster_entries?${query}`, { headers });
    assert.equal(ambiguous.status, 300);
    assert.equal((await ambiguous.json()).code, 'PGRST201');
    query.set('select', LEAGUE_ROSTER_SELECT);
    const fixed = await fetch(`${origin}/roster_entries?${query}`, { headers });
    assert.equal(fixed.status, 200);
    const rows = await fixed.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].athlete.display_name, 'REST athlete');
    assert.equal(rows[0].athlete.competition.name, "Brock Men's Hockey");
    const metrics = await fetch(
      `${origin}/athletes?${new URLSearchParams({ select: 'id,summaries:athlete_season_summaries(*)', id: `eq.${ids.athlete}` })}`,
      { headers },
    );
    assert.equal(metrics.status, 200);
    assert.equal((await metrics.json())[0].summaries[0].supplied_adp, 12.5);
    const adps = await fetch(`${origin}/rpc/get_pool_adp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_pool_id: 'b0000000-0000-4000-8000-000000000003' }),
    });
    assert.equal(adps.status, 200);
    assert.equal((await adps.json())[ids.athlete].average, 12.5);
    console.log(
      'Real PostgREST verified ambiguous join failure, explicit roster embedding and supplied ADP reads at AAL1',
    );
  } finally {
    if (created) {
      assert.match(container, /^bf-roster-rest-[a-f0-9-]+$/u);
      await exec('docker', ['rm', '--force', container], { windowsHide: true });
    }
  }
}
