import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildManifest } from './import-brock-beta-data.mjs';
import { rosterPlan, rosterSql, sourceUuid } from './lib/roster-materialization.mjs';

// Every fixture write is in one rollback-only local transaction. Hosted
// credentials and hosted query options are never read by this rehearsal.
const operatorId = randomUUID();
const memberId = randomUUID();
const plan = rosterPlan(await buildManifest(), operatorId);
assert.equal(plan.players.length, 120);
assert.equal(plan.excluded.length, 2);
const quote = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const year = Number(
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric' }).format(
    new Date(),
  ),
);
let fixture = `begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
select id,id::text||'@example.test',now(),jsonb_build_object('display_name','Roster fixture',
  'beta_age_eligible',true,'beta_eligibility_year',${year},
  'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1'),now(),now()
from (values ('${operatorId}'::uuid),('${memberId}'::uuid)) fixture(id);
insert into public.user_roles(user_id,role) values ('${operatorId}','admin');
`;
for (const item of plan.imports) {
  const id = sourceUuid(`local-fixture-import:${item.revisionHash}`);
  fixture += `insert into public.source_imports(id,source,source_hash,season_id,kind,payload,imported_by)
values ('${id}','${item.source.replaceAll("'", "''")}','${item.revisionHash}','${plan.seasonId}','roster',
${quote({ sourceHash: item.sourceHash, approval: { approvalId: item.approvalId } })},'${operatorId}');
insert into public.source_rows(import_id,row_number,source_key,raw,normalized)
select '${id}',(r->>'rowNumber')::int,'${item.revisionHash}:'||(r->>'rowNumber'),r->'raw',r->'normalized'
from jsonb_array_elements(${quote(item.rows)}) r;
`;
}
const publication = rosterSql(plan)
  .replace(/^begin;\n/u, '')
  .replace('\ncommit;\n', '\n');
const sql = `${fixture}
${publication}
drop table roster_expected,roster_programs,roster_release;
${publication}
do $$ begin
  if (select count(*) from public.audit_log where action='roster.directory_published' and actor_id='${operatorId}')<>1 then
    raise exception 'Retry created duplicate audit events'; end if;
  if exists(select 1 from public.source_rows where normalized->>'participationStatus'='opted_out' and entity_id is not null) then
    raise exception 'Opted-out source received a canonical identity'; end if;
end $$;
select set_config('request.jwt.claim.sub','${memberId}',true);
select set_config('request.jwt.claims','{"sub":"${memberId}","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.athletes a join public.athlete_seasons m on m.athlete_id=a.id
    where a.status='active' and m.directory_visible and m.season_id='${plan.seasonId}')<>120 then
    raise exception 'Ordinary member directory query did not return 120 players'; end if;
  if (select count(*) from public.athlete_season_summaries)<>240 then
    raise exception 'Ordinary member cannot read all season/projection summaries'; end if;
  if exists(select 1 from public.athlete_seasons where draft_eligible) then
    raise exception 'Directory publication activated draft eligibility'; end if;
end $$;
set local role anon;
do $$ begin
  if (select count(*) from public.athletes)<>0 then raise exception 'Anonymous roster leak'; end if;
end $$;
reset role;
rollback;
select 'roster materialization, retry, opt-outs, summaries and ordinary-member/anonymous RLS passed' as result;
`;
const directory = path.resolve('dev/tmp/roster-directory-rehearsal');
await mkdir(directory, { recursive: true });
const sqlPath = path.join(directory, 'rehearsal.sql');
await writeFile(sqlPath, sql, { mode: 0o600 });
// Local CLI queries use prepared statements, which reject a multi-statement
// transaction. psql's simple protocol executes the same SQL atomically.
const output = execFileSync(
  'docker',
  [
    'exec',
    '-i',
    'supabase_db_brock-fantasy',
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
    '-t',
    '-A',
  ],
  { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
);
assert.match(
  output,
  /roster materialization, retry, opt-outs, summaries and ordinary-member\/anonymous RLS passed/u,
);
console.log(
  'Local roster rehearsal passed: 120 players, two exclusions, idempotent retry, 240 summaries, authenticated reads and anonymous denial. All fixture writes rolled back.',
);
