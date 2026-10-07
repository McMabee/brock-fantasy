-- Record the operator's calendar-year eligibility attestation without collecting DOB.
-- This table is private, writeable only through the Auth profile trigger, and is
-- never used to grant admin roles or other privileges from user-editable metadata.
create table beta_private.account_eligibility_attestations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  registration_year integer not null check (registration_year between 2026 and 9999),
  policy_version text not null,
  attested_at timestamptz not null
);

alter table beta_private.account_eligibility_attestations enable row level security;
revoke all on beta_private.account_eligibility_attestations from public, anon, authenticated, service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  registration_year integer := extract(year from timezone('America/Toronto', new.created_at))::integer;
begin
  if new.raw_user_meta_data -> 'beta_age_eligible' is distinct from 'true'::jsonb
    or new.raw_user_meta_data -> 'beta_eligibility_year' is distinct from to_jsonb(registration_year)
    or new.raw_user_meta_data ->> 'beta_eligibility_policy_version' is distinct from 'brock-beta-eligibility-2026-10-06.1'
  then
    raise exception 'Calendar-year eligibility attestation required' using errcode = '22023';
  end if;
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)), 60));
  insert into beta_private.account_eligibility_attestations(user_id, registration_year, policy_version, attested_at)
  values(new.id, registration_year, 'brock-beta-eligibility-2026-10-06.1', new.created_at);
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
