# Standings production release - November 3, 2026

Tarik reported that league standings and their statistics were not updating. The published matchup totals were present, but eight expired Week 1 matchups across Beta Test League, Young Adults, and BFA Team League still had `active` status. Standings intentionally aggregate only finalized regular-season matchups, so all 16 teams showed zero wins, losses, points for, and points against.

The rollover fix had already been merged to `main` in `2ded93d40e9d9326081ba8a6be3cecc11bec6b88` and deployed to Vercel. Its database migration had not been applied to production, and no `cron.job` invoked the rollover worker. All 12 scoring games in the expired period were final with complete published statistics. No scoring formula or athlete data correction was needed.

## Release

- The project owner explicitly authorized the fix, a push to `main`, and deployment
- Verified GitHub identity `McMabee`, repository `McMabee/brock-fantasy`, branch `main`, and a clean checkout synchronized with `origin/main`
- Verified Supabase project `fdovowiihxowzatewxgv` and Vercel project `prj_nNxNb94VhM7u0Cxhtvlr3URdE0bP` under team `team_dSCIDBFXORamWfGvBEgSsMKq`
- The linked database dry run listed only `20261103221206_automatic_matchup_period_rollover.sql`, with no seeds or role changes
- Applied that migration through `supabase db push --linked --project-ref fdovowiihxowzatewxgv --skip-vault --yes`
- Observed exactly one active `brock-matchup-rollover` job, job ID 11, owned by `postgres`, running `select public.advance_matchup_periods(1000);` every minute
- Observed the first scheduled run succeed at `2026-11-04T01:44:00Z`, November 3 at 8:44 PM in Toronto

The scheduled worker finalized all eight expired Week 1 matchups and activated all eight current Week 2 matchups without a manual status update. All 16 teams then had one completed result and populated points for and points against. Future periods remained scheduled. The existing worker waits for complete publication across all scoring competitions before finalizing later periods.

## Verification

Fresh local checks passed 356 targeted pgTAP assertions, migration replay, rejection of a competing scheduler, simultaneous-worker and idempotency checks, 14 calendar-selection and handoff tests, and SQL syntax validation. The hosted error-level security advisor reported no issues after migration application.

Read-only hosted evidence was captured immediately before deployment and after the first scheduled run. Counts and ordered row hashes matched for every preserved dataset:

| Dataset                     | Rows | MD5                              |
| --------------------------- | ---- | -------------------------------- |
| Fantasy point events        | 589  | c2dd7cb9daaf56b4ca26c22e4199a6f0 |
| Published player stat lines | 178  | 865c769143f125d00cbd7fa634150abf |
| Game lineup snapshots       | 348  | 330903c635b5ce488c21bb51eb58f4da |
| Matchup scores and schedule | 60   | 62f4fa2648bdbfb95503200cb805201b |

The matchup hash excludes only the two lifecycle fields changed by rollover: `status` and `finalized_at`. The other hashes include every stored column. An independent sum of scoring events in each matchup window found zero mismatches across all 60 matchup totals. Evidence files are retained under the ignored `tmp/standings-release-*` paths and contain team identifiers; raw rows are excluded from this document.

This release verifies scheduled production execution and the standings database results. A signed-in hosted browser check was unavailable because local browser use is disabled in Work settings. The client already polls standings every five seconds while active. The full application/import suite was not rerun; its separately documented private-fixture and date-sensitive failures remain outside this release's checks.

## Recovery

If scheduled execution fails, inspect `cron.job_run_details` for job 11 and correct the failing dependency. Later ticks automatically drain eligible overdue periods. If necessary, deactivate `brock-matchup-rollover` through Supabase Cron. Preserve finalized results and earned points; do not reset drafts, rewrite matchups, or delete scoring events to undo scheduler configuration.
