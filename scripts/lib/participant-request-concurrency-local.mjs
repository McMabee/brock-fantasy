import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyParticipantRequestConcurrency({ database, executeSql }) {
  assert.match(database, /^bf_registration_[a-z0-9_]+$/u);
  const [admin, otherAdmin, recipient, referenceVersion, reference, scan, match] = Array.from(
    { length: 7 },
    () => randomUUID(),
  );
  const actor = (user, aal = 'aal2') =>
    `select set_config('request.jwt.claim.sub','${user}',true);select set_config('request.jwt.claims','{"sub":"${user}","session_id":"${user}","role":"authenticated","aal":"${aal}"}',true);set local role authenticated;`;
  await executeSql(`
    insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
    select id,email,now(),now(),jsonb_build_object('display_name',name,'varsity_role','none','varsity_programs','[]'::jsonb,'beta_age_eligible',true,
      'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1')
    from(values('${admin}'::uuid,'request-admin@example.test','Request Admin'),('${otherAdmin}'::uuid,'request-other-admin@example.test','Other Request Admin'),('${recipient}'::uuid,'request-recipient@example.test','Request Recipient'))u(id,email,name);
    insert into auth.sessions(id,user_id,aal)values('${admin}','${admin}','aal2'),('${otherAdmin}','${otherAdmin}','aal2'),('${recipient}','${recipient}','aal1');
    insert into public.user_roles(user_id,role)values('${admin}','admin'),('${otherAdmin}','admin');
    update beta_private.release_controls set service_email_enabled=true,participant_confirmation_enabled=true;
    insert into beta_private.participant_reference_versions(id,content_hash,season_id,sources,active)values('${referenceVersion}','concurrent-requests','b0000000-0000-4000-8000-000000000002','[]',true);
    insert into beta_private.participant_references(version_id,id,name,role,programs,sources,evidence_hash,normalized_name,sorted_name,usernames,inferred_usernames)
      values('${referenceVersion}','${reference}','Request Recipient','athlete',array['womens_hockey'],'[]','concurrent-hash','request recipient','recipient request','{}','{}');
    insert into beta_private.participant_scan_runs(id,reference_version_id,scoring_version,weights,completed_at)values('${scan}','${referenceVersion}','fixture','{}',now());
    insert into beta_private.participant_scan_matches(id,scan_id,user_id,reference_id,account_hash,reference_hash,score,evidence)
      values('${match}','${scan}','${recipient}','${reference}',beta_private.participant_account_hash('Request Recipient','request-recipient@example.test'),'concurrent-hash',90,'{"reference":{"role":"athlete","programs":["womens_hockey"]}}');
  `);
  const sends = await Promise.allSettled(
    [admin, otherAdmin].map((user, index) =>
      executeSql(
        `begin;${actor(user)}select public.admin_request_participant_confirmation('${match}','concurrent-send-${index}');select pg_sleep(0.25);commit;`,
      ),
    ),
  );
  assert.equal(sends.filter((result) => result.status === 'fulfilled').length, 1);
  const sendFailure = sends.find((result) => result.status === 'rejected');
  assert.match(String(sendFailure.reason.stderr ?? sendFailure.reason), /last 24 hours/u);
  const requestId = (
    await executeSql(
      `select id from beta_private.participant_confirmation_requests where user_id='${recipient}';`,
    )
  ).trim();
  assert.match(requestId, /^[0-9a-f-]{36}$/u);
  assert.equal(
    (
      await executeSql(
        `select count(*) from beta_private.service_email_jobs where participation_request_id='${requestId}';`,
      )
    ).trim(),
    '1',
  );
  await executeSql(
    `begin;${actor(recipient, 'aal1')}select public.submit_participant_confirmation('${requestId}','coach',array['womens_volleyball'],'Confirmed program','concurrent-response');commit;`,
  );
  const updatedAt = (
    await executeSql(
      `select updated_at from beta_private.participant_confirmation_requests where id='${requestId}';`,
    )
  ).trim();
  assert.match(updatedAt, /^[0-9 :.+-]+$/u);
  const approvals = await Promise.allSettled(
    [admin, otherAdmin].map((user, index) =>
      executeSql(
        `begin;${actor(user)}select public.admin_review_participant_confirmation('${requestId}',true,'Reviewed the recipient response','${updatedAt}','concurrent-approval-${index}');select pg_sleep(0.25);commit;`,
      ),
    ),
  );
  assert.equal(approvals.filter((result) => result.status === 'fulfilled').length, 1);
  const reviewFailure = approvals.find((result) => result.status === 'rejected');
  assert.match(
    String(reviewFailure.reason.stderr ?? reviewFailure.reason),
    /reload and review again/u,
  );
  const result = JSON.parse(
    (
      await executeSql(
        `select json_build_object('role',p.role,'programs',p.programs,'revision',p.revision,'status',r.status) from beta_private.account_participation p join beta_private.participant_confirmation_requests r on r.user_id=p.user_id where r.id='${requestId}';`,
      )
    ).trim(),
  );
  assert.deepEqual(result, {
    role: 'coach',
    programs: ['womens_volleyball'],
    revision: 2,
    status: 'approved',
  });
  console.log(
    'Concurrent admin sends create one request and email job; concurrent approvals apply the recipient response exactly once',
  );
  const [competition, team, athlete] = Array.from({ length: 3 }, () => randomUUID());
  const pool = 'b0000000-0000-4000-8000-000000000003';
  await executeSql(`
    update public.player_pools set is_active=true,rankings_approved_at=now() where id='${pool}';
    insert into public.sports(code,name)values('hockey','Hockey')on conflict(code)do nothing;
    insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id)
      select '${competition}',id,'womens','Concurrent ranking fixture','2026-27','b0000000-0000-4000-8000-000000000004' from public.sports where code='hockey';
    insert into public.teams(id,competition_id,name,short_name,is_brock)values('${team}','${competition}','Brock ranking fixture','BRO',true);
    insert into public.athletes(id,competition_id,team_id,display_name,position)values('${athlete}','${competition}','${team}','Ranking Fixture','F');
    insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)
      values('${athlete}','b0000000-0000-4000-8000-000000000002','${competition}','${team}',array['F'],true,true);
    insert into public.pool_competitions(pool_id,competition_id)values('${pool}','${competition}');
    insert into public.athlete_season_summaries(athlete_id,season_label,source,fantasy_points,games_played,stats,kind)
      values('${athlete}','2026-27','Concurrent fixture',100,20,'{"goals":10}','supplied_projection');
  `);
  const preview = JSON.parse(
    (
      await executeSql(
        `begin;${actor(admin)}select public.admin_get_ranking_review('2026-27',true);commit;`,
      )
    )
      .trim()
      .split('\n')
      .at(-1),
  );
  assert.match(preview.input_hash, /^[0-9a-f]{32}$/u);
  const publish = (user, index) =>
    `begin;${actor(user)}select public.admin_publish_preseason_review('${pool}','${preview.input_hash}','Reviewed concurrent publication inputs','concurrent-ranking-${index}');select pg_sleep(0.25);commit;`;
  const publications = await Promise.allSettled(
    [admin, otherAdmin].map((user, index) => executeSql(publish(user, index))),
  );
  assert.equal(publications.filter((result) => result.status === 'fulfilled').length, 2);
  const versions = JSON.parse(
    (
      await executeSql(
        `select json_agg(version order by version) from public.preseason_ranking_publications where pool_id='${pool}';`,
      )
    ).trim(),
  );
  assert.deepEqual(versions, [1, 2]);
  await executeSql(publish(admin, 0));
  assert.equal(
    (
      await executeSql(
        `select count(*) from public.preseason_ranking_publications where pool_id='${pool}';`,
      )
    ).trim(),
    '2',
  );
  assert.equal(
    (
      await executeSql(
        `select count(*) from public.preseason_ranking_entries where athlete_id='${athlete}' and projected_points=100 and position_rank=1 and display_data->'stats'->>'goals'='10';`,
      )
    ).trim(),
    '2',
  );
  console.log(
    'Concurrent ranking publications receive distinct immutable versions and retries reuse the original publication',
  );
}
