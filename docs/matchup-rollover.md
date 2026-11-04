# Matchup period rollover

Investigation: November 3, 2026, against `McMabee/brock-fantasy` at `528b95a` and the linked Brock Sports Fantasy project `fdovowiihxowzatewxgv`. The original investigation used read-only hosted checks. The fix was subsequently merged in `2ded93d` and its database migration was released on November 3, 2026. See the [production standings release record](standings-release-2026-11-03.md) for observed results and verification boundaries.

## Findings

- The selector treated any stored `active` matchup as current and preferred the lowest period number, even after its end
- Production contained eight expired active Week 1 matchups and eight scheduled Week 2 matchups
- Week 1 ended and Week 2 began at `2026-11-01T04:00:00Z` (Toronto midnight, UTC-04:00), while Week 2 ends at `2026-11-14T05:00:00Z` (Toronto midnight, UTC-05:00)
- No repository workflow, application call, Edge Function, or live `cron.job` registration invoked `advance_matchup_periods`
- No external scheduler was discovered; infrastructure outside the repository and Supabase job inventory cannot be conclusively excluded
- The existing worker guarded finalization using `leagues.competition_id`, but 16 pool-based leagues have no value in that legacy column
- All 12 regular-season games found in expired pool matchup windows were final with complete published stats at inspection time

## Implementation

| Files                                                                                   | Purpose                                                                                                           |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/client/src/lib/matchup-selection.ts`                                              | Select by absolute `startsAt <= now < endsAt`, independent of stored status, in O(n) time and O(1) space          |
| `apps/client/src/hooks/use-matchup-clock.ts`                                            | Refresh mounted screens at calendar boundaries and when the app resumes                                           |
| `apps/client/src/app/league/[id].tsx`                                                   | Use the calendar clock and label upcoming/latest fallback matchups accurately                                     |
| `apps/client/src/app/matchups/[leagueId].tsx`                                           | Use the same clock while preserving explicit history buttons and `matchupId` links                                |
| `supabase/migrations/20261103221206_automatic_matchup_period_rollover.sql`              | Correct finalization safeguards, add bounded-scan indexes, and register one named cron worker                     |
| `scripts/lib/matchup-selection.test.mjs`                                                | Deterministic selection, gaps, future seasons, malformed records, and both DST transitions                        |
| `supabase/tests/310-matchup-rollover.test.sql`                                          | Lifecycle, score/ledger preservation, standings, administrative publication, permissions, and repeat registration |
| `scripts/lib/matchup-rollover-local.mjs` and `scripts/test-registration-migrations.mjs` | Isolated migration replay, conflicting-job rejection, and simultaneous-worker verification                        |
| `scripts/test-matchup-rollover-browser.mjs` and `package.json`                          | Desktop/mobile rollover and history regression commands without private roster files or hosted writes             |

Dates returned from Postgres `timestamptz` contain explicit offsets. Selection compares their absolute instants without reconstructing Toronto midnight in the device timezone. The optional injected `now` argument preserves existing two-argument callers. A calendar-current matchup retains its operational `scheduled`, `active`, or `final` status. Overlapping records prefer the most recently started period. Outside a current interval, selection prefers the earliest upcoming scheduled matchup, then the most recently ended matchup, even if finalization is pending. Records without either calendar field retain the previous status-based fallback; malformed or partially dated records are excluded. Future records marked active are not treated as current.

## Automatic advancement

The migration uses the existing pg_cron installation. `brock-matchup-rollover` runs `select public.advance_matchup_periods(1000);` every minute, as the migration's database role. No client, HTTP endpoint, token, or application visit is required. Named registration updates the existing job rather than appending another one, as described in the [Supabase Cron quickstart](https://supabase.com/docs/guides/cron/quickstart). A differently named database job that directly invokes the worker causes migration failure so an operator can reconcile it first.

Each tick independently activates up to 1,000 current scheduled pairings and finalizes up to 1,000 eligible expired pairings. Comparisons use stored timestamps and the transaction's fixed `now()`. Row locks with `SKIP LOCKED` prevent simultaneous workers from processing the same pairing. Subsequent ticks drain any backlog, including several missed periods and seasonal gaps. Already-finalized matchups, scores, opponents, period timestamps, and point events are never rewritten by this worker.

Pool leagues wait for scoring games in every pool competition. Scheduled/in-progress games block finalization, as do final games whose administrative stat publication remains incomplete. Cancelled, postponed, exhibition, and unrelated-competition games do not block pool results. Legacy leagues retain their original game-status safeguard. Completion on a later date permits finalization on the next tick. Result notifications use the existing transition trigger and deduplication keys.

## Scoring impact

Both selector callers render read-only matchup views. Selecting another matchup does not submit stats or assign points. `useLeague` maps the stored timestamps without conversion, and historical detail calls retain the explicitly selected matchup ID.

Game-start lineup snapshots and point-event replay assign points by game timestamps, not matchup status. Replay and administrator corrections recalculate matchup totals without requiring the matchup to be active. Canonical athlete totals and leaderboards are likewise independent of this selector. No Week 2 point-calculation or stat-assignment defect was established, and scoring formulas were not changed.

Standings do require `final` matchup status for wins, losses, ties, and head-to-head results. Stale Week 1 statuses therefore delay those results and final-result notifications. Rollover restores their existing lifecycle once game publication is complete. Tests verify that newly finalized wins appear while earned points and previously finalized results remain intact. This investigation did not constitute a full production scoring audit.

## Verification

```powershell
node --experimental-strip-types --test scripts/lib/matchup-selection.test.mjs scripts/lib/backlog-flows.test.mjs
pnpm test:matchup-rollover:local
pnpm build:web
pnpm test:matchup-rollover:browser
pnpm typecheck
pnpm lint
pnpm lint:sql
pnpm format:check
pnpm smoke:mobile
```

Passed: 14 selection/handoff tests, all 1,222 pgTAP assertions in the complete database suite, 356 targeted pgTAP assertions, migration replay and competing-job rejection, concurrent-worker checks, desktop/mobile browser regressions, TypeScript, ESLint, SQL parsing, formatting, web export, Android/iOS export smoke tests, and the browser secret-boundary check. A local `plpgsql_check_function_tb` check reported no issues in the new worker. A read-only error-level security advisor check found no issues in the existing hosted baseline; that check does not validate an undeployed migration.

The local database command creates and removes only isolated test databases inside `supabase_db_brock-fantasy`. It replays all migrations, replays this migration a second time, rejects a competing scheduler, and runs rollover plus API permission, lineup, history, and administrative scoring tests. Cron registrations are recorded in the existing test scaffold; background execution is excluded. A separate rollback-only check against the real local pg_cron extension confirmed repeated named registration returns the same job ID and leaves one job. Neither check proves hosted execution.

The exported desktop and mobile screens were tested with synthetic API responses and a controlled Toronto clock. At the exact boundary they select scheduled Week 2 despite expired active Week 1, keep history buttons and direct history URLs functional, and show the latest matchup after the season. All fixture requests are restricted to the local preview origin.

The broader `pnpm test` run passed 51 domain tests and 114 of 119 import tests at the time it ran. Four import tests could not read the missing private `logic/Fall.Winter Brock Fantasy Information - Goalie stats.csv`; the unrelated `official-schedule-sync` test also failed an assertion expecting an October 17 fixture to be reported as missing after that date had passed. Those files are unchanged. Do not describe the full application suite or CI as green until these separate failures are resolved.

## Production rollout procedure

The first production rollout is complete. Retain this procedure for future releases; production changes require authorization from the project owner.

1. Review and merge the bug-fix PR through the normal release process
2. Reconfirm the target is `fdovowiihxowzatewxgv`, inspect all pending migrations, and check for external rollover automation before applying anything
3. Review the pending SQL with `pnpm exec supabase db push --linked --project-ref fdovowiihxowzatewxgv --skip-vault --dry-run`; stop if it includes unreviewed changes
4. Once separately approved, apply the reviewed migration using `pnpm exec supabase db push --linked --project-ref fdovowiihxowzatewxgv --skip-vault` through the normal database release process
5. Deploy the approved web commit through the normal hosting pipeline; the frontend calendar fix also works before the database migration is applied
6. Confirm exactly one active `brock-matchup-rollover` job, owned by the expected privileged database role, and observe successful runs and eligible period transitions

Read-only acceptance queries:

```sql
select jobid, jobname, schedule, command, active, username, database
from cron.job where jobname = 'brock-matchup-rollover';

select r.status, r.start_time, r.end_time, r.return_message
from cron.job_run_details r join cron.job j using (jobid)
where j.jobname = 'brock-matchup-rollover'
order by r.start_time desc limit 10;

select period, status, min(starts_at) starts_at, max(ends_at) ends_at, count(*)
from public.matchups group by period, status order by period, status;
```

If no runs appear, verify the existing pg_cron extension and launcher configuration and the job's active flag in the Supabase dashboard. If a run fails, inspect `return_message` and database logs before retrying. No manual row changes are required: later ticks catch up automatically. Pending administrative publication intentionally leaves expired results unfinalized, while the frontend continues to show the correct current calendar period.

Cron history is not automatically pruned by pg_cron. Include this job in the project's operational history-retention policy, following the existing seven-day draft-worker precedent, and monitor failed ticks. If rollback is necessary, deactivate the job through Supabase Cron and revert the application commit through the normal release process; do not reopen already finalized history or delete earned points.
