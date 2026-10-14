import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPublishedManifest as buildManifest } from './lib/published-rosters.mjs';
import { rosterPlan, rosterSql, sourceUuid } from './lib/roster-materialization.mjs';
import { heightPlan, heightSql } from './lib/height-materialization.mjs';

const operator = randomUUID();
const manifest = await buildManifest();
const roster = rosterPlan(manifest, operator);
const heights = heightPlan(
  manifest,
  operator,
  JSON.parse(await readFile('data/brock-heights-2026-27.json', 'utf8')),
);
const json = (value) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
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
// Associate the directory fixture with a player pool to exercise snapshot invalidation.
sql += `insert into public.pool_competitions(pool_id,competition_id)
select distinct p.id,m.competition_id from public.player_pools p join public.athlete_seasons m on m.season_id=p.season_id
where m.athlete_id='${heights.heights[0].id}' on conflict do nothing;`;
sql += `update public.athletes set bio=bio||'{"preserved":"sentinel","headshot":{"url":"https://gobadgers.ca/images/fixture.jpg"}}';
create temp table before_heights as select id,bio from public.athletes;`;
sql += inner(heightSql(heights));
sql += `create temp table before_adp as select id,state_version from public.player_pools;
update public.athlete_season_summaries set supplied_adp=12.5 where athlete_id='${heights.heights[0].id}' and kind='supplied_projection' and season_label='2026-27';
do $$ begin
 if not exists(select 1 from public.player_pools p join before_adp b using(id) where p.state_version>b.state_version) then raise exception 'ADP update did not invalidate the player pool'; end if;
end $$;
update public.athlete_season_summaries set supplied_adp=null where supplied_adp is not null;`;
sql += 'drop table approved_heights;';
sql += inner(heightSql(heights));
sql += `do $$ begin
 if (select count(*) from public.athletes where bio ? 'height') <> ${heights.heights.length} then raise exception 'Height readback differs'; end if;
 if exists(select 1 from public.athletes a full join before_heights b using(id) where a.id is null or b.id is null or a.bio->'headshot' is distinct from b.bio->'headshot' or a.bio->>'preserved'<>'sentinel') then raise exception 'Canonical identity or bio was changed'; end if;
 if exists(select 1 from public.athlete_season_summaries where supplied_adp is not null) then raise exception 'ADP was fabricated'; end if;
 if (select count(*) from public.audit_log where action='heights.materialized') <> 1 then raise exception 'Height retry duplicated audit'; end if;
end $$;
rollback;
select 'Verified ${heights.heights.length} height updates, ${heights.missing.length} missing values, stable athlete IDs and headshots, NULL ADP, and idempotent publication' as readback;`;
await mkdir('dev/tmp/height-rehearsal', { recursive: true });
const file = path.resolve('dev/tmp/height-rehearsal/rehearsal.sql');
await writeFile(file, sql);
const output = execFileSync(process.execPath, ['scripts/test-registration-migrations.mjs'], {
  encoding: 'utf8',
  env: { ...process.env, BROCK_TEST_EXTRA_SQL: file },
  maxBuffer: 16 * 1024 * 1024,
});
assert.match(output, /stable athlete IDs and headshots, NULL ADP/u);
await writeFile('dev/tmp/height-rehearsal/readback.txt', output);
console.log(
  output
    .split('\n')
    .filter((line) => !line.startsWith('{'))
    .join('\n'),
);
