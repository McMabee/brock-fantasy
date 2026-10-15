-- Roster publication is independent of draft/ranking activation.
alter table public.athlete_seasons
  add column directory_visible boolean not null default false;
comment on column public.athlete_seasons.directory_visible is
  'Explicitly approved roster display; does not grant draft eligibility.';

create index athlete_seasons_directory_athlete_idx
  on public.athlete_seasons (athlete_id) where directory_visible;

create policy roster_directory_memberships_read on public.athlete_seasons
  for select to authenticated using (directory_visible);
create policy roster_directory_athletes_read on public.athletes
  for select to authenticated using (
    status = 'active' and exists (
      select 1 from public.athlete_seasons membership
      where membership.athlete_id = athletes.id and membership.directory_visible
    )
  );
create policy roster_directory_competitions_read on public.competitions
  for select to authenticated using (exists (
    select 1 from public.athlete_seasons membership
    where membership.competition_id = competitions.id and membership.directory_visible
  ));
create policy roster_directory_teams_read on public.teams
  for select to authenticated using (exists (
    select 1 from public.athlete_seasons membership
    where membership.team_id = teams.id and membership.directory_visible
  ));

grant select on public.athletes, public.athlete_seasons, public.competitions,
  public.teams, public.athlete_season_summaries to authenticated;
