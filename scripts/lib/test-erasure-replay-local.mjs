import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { erasureReplaySql } from './erasure-replay.mjs';

export async function verifyErasureReplay({ database, executeSql }) {
  assert.match(database, /^bf_registration_[a-z0-9_]+$/u);
  const user = randomUUID();
  const source = randomUUID();
  const replay = erasureReplaySql({
    capturedAt: new Date().toISOString(),
    entries: [
      { kind: 'account', id: user },
      { kind: 'source_import', id: source },
    ],
  });
  await executeSql(`begin;
    insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)values('${user}','restore-${user}@example.test',now(),now(),
      jsonb_build_object('display_name','Restore fixture','varsity_role','none','varsity_programs','[]'::jsonb,'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::integer,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1'));
    insert into public.notifications(user_id,kind,title,body)values('${user}','fixture','Restored notice','Private restored content');
    insert into public.source_imports(id,source,source_hash,kind,payload)values('${source}','restore-fixture','${source}','roster','{}');
    insert into public.source_rows(import_id,row_number,source_key,raw)values('${source}',1,'private-fixture','{}');
    ${replay}${replay}
    do $$begin
      if exists(select 1 from auth.users where id='${user}')or exists(select 1 from public.notifications where user_id='${user}')or exists(select 1 from public.source_rows where import_id='${source}')then
        raise exception 'Deletion replay restored erased personal data';
      end if;
    end$$;
    rollback;`);
  console.log(
    'PASS isolated deletion replay removes restored identities, notices and restrictive source rows and tolerates reruns',
  );
}
