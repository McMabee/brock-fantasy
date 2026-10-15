import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPublishedManifest as buildManifest } from './lib/published-rosters.mjs';
import { rosterPlan, rosterSql, sourceUuid } from './lib/roster-materialization.mjs';
import { buildManifest as buildCurrentManifest } from './import-brock-beta-data.mjs';
import { rosterMetricsPlan, rosterMetricsSql } from './lib/roster-metrics.mjs';

const operator = randomUUID();
const manifest = await buildManifest();
const roster = rosterPlan(manifest, operator);
const metrics = rosterMetricsPlan(
  await buildCurrentManifest(),
  manifest,
  JSON.parse(await readFile('data/brock-heights-2026-27.json', 'utf8')),
  operator,
  JSON.parse(await readFile('dev/docs/evidence/2026-10-14-roster-suppressions.json', 'utf8')),
);
const json = (value) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
const suppliedAdpCount = metrics.players.filter((player) => player.suppliedAdp !== null).length;
let sql = `begin;
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data) values('${operator}','height-fixture@example.test',now(),now(),jsonb_build_object('display_name','Height fixture','beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1'));
insert into public.user_roles(user_id,role) values('${operator}','admin');`;
for (const item of roster.imports) {
  const id = sourceUuid(`height-test:${item.revisionHash}`);
  sql += `insert into public.source_imports(id,source,source_hash,season_id,kind,payload,imported_by) values('${id}','${item.source.replaceAll("'", "''")}','${item.revisionHash}','${roster.seasonId}','roster',${json({ sourceHash: item.sourceHash, approval: { approvalId: item.approvalId } })},'${operator}');
insert into public.source_rows(import_id,row_number,source_key,raw,normalized) select '${id}',(r->>'rowNumber')::int,'${item.revisionHash}:'||(r->>'rowNumber'),r->'raw',r->'normalized' from jsonb_array_elements(${json(item.rows)}) r;`;
}
const inner = (value) => value.replace(/^begin;\n/u, '').replace(/\ncommit;(?:\r?\n|$)/gu, '\n');
sql += inner(rosterSql(roster));
// - Associate the directory fixture with a player pool to exercise snapshot invalidation
sql += `insert into public.pool_competitions(pool_id,competition_id)
select distinct p.id,m.competition_id from public.player_pools p join public.athlete_seasons m on m.season_id=p.season_id
where m.athlete_id='${metrics.players[0].id}' on conflict do nothing;
update public.athletes set bio=bio||'{"preserved":"sentinel","headshot":{"url":"https://gobadgers.ca/images/fixture.jpg"}}';
create temp table before_metrics as select id,bio->'headshot' as headshot,bio->'rosterSource' as source from public.athletes;
create temp table before_revision as select state_version from public.player_pools where id='b0000000-0000-4000-8000-000000000003';`;
sql += inner(rosterMetricsSql(metrics));
sql += `create temp table after_revision as select state_version from public.player_pools where id='b0000000-0000-4000-8000-000000000003';`;
sql += 'drop table metric_release,metric_players,metric_exclusions;';
sql += inner(rosterMetricsSql(metrics));
sql += `do $$ begin
 if (select count(*) from public.athletes where status='active') <> 119 then raise exception 'Participant count differs'; end if;
 if (select count(*) from public.athletes where bio ? 'height') <> 59 then raise exception 'Height readback differs'; end if;
 if (select count(*) from public.athlete_season_summaries where supplied_adp is not null) <> ${suppliedAdpCount} then raise exception 'ADP readback differs'; end if;
 if exists(select 1 from public.athletes a full join before_metrics b using(id) where a.id is null or b.id is null or a.bio->'headshot' is distinct from b.headshot or a.bio->'rosterSource' is distinct from b.source or a.bio->>'preserved'<>'sentinel') then raise exception 'Canonical identity or bio was changed'; end if;
 if (select count(*) from public.audit_log where action='roster.metrics_materialized') <> 1 then raise exception 'Metric retry duplicated audit'; end if;
 if not exists(select 1 from public.player_pools p,before_revision b where p.id='b0000000-0000-4000-8000-000000000003' and p.state_version>b.state_version) then raise exception 'No pool invalidation'; end if;
 if exists(select 1 from public.player_pools p,after_revision a where p.id='b0000000-0000-4000-8000-000000000003' and p.state_version<>a.state_version) then raise exception 'Retry invalidated unchanged pool'; end if;
end $$;
rollback;
select 'Verified 119 metric updates, ${suppliedAdpCount} supplied ADPs, 59 heights, stable athlete IDs and headshots, one opt-out, and idempotent publication' as readback;`;
await mkdir('dev/tmp/roster-metrics-rehearsal', { recursive: true });
const file = path.resolve('dev/tmp/roster-metrics-rehearsal/rehearsal.sql');
await writeFile(file, sql);
const output = execFileSync(process.execPath, ['scripts/test-registration-migrations.mjs'], {
  encoding: 'utf8',
  env: { ...process.env, BROCK_TEST_EXTRA_SQL: file },
  maxBuffer: 16 * 1024 * 1024,
});
assert.match(output, /stable athlete IDs and headshots, one opt-out/u);
await writeFile('dev/tmp/roster-metrics-rehearsal/readback.txt', output);
console.log(
  output
    .split('\n')
    .filter((line) => !line.startsWith('{'))
    .join('\n'),
);
