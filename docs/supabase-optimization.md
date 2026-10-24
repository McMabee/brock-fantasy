# Supabase optimization release

This change preserves the existing public RPC contracts, draft command locks, timers,
idempotency, worker schedules, scoring and roster rules. Tarik's deleted league is outside
the change. No paid service or compute upgrade is required.

Five new migrations independently tighten the automatic-RLS function's grants, consolidate
policies, add the notification snapshot, aggregate player insights, and version draft
catalogs. The application uses the additive notification RPC, suspends inactive polling,
isolates pending reads by session, and shares equivalent draft matching calculations.
Foreground refresh intervals remain two seconds for drafts and five seconds for the
existing notification, chat and league polls.

## Local evidence

`pnpm test:supabase-optimization:local --prove-upgrade` uses disposable users and ten local
fixture leagues, real Auth/PostgREST and the exported application HTTP routes. It never
connects its fixtures or load tests to production. It compares the historical and new SQL
under the same workload and confirms identical insight JSON, including recorded stats,
projections, fixtures and supplied ADP.

The October 22 benchmark produced these median database times:

| Athletes |      Before |    After | Reduction |
| -------- | ----------: | -------: | --------: |
| 120      |    160.5 ms |  18.5 ms |     88.4% |
| 1,200    | 15,331.8 ms | 252.7 ms |     98.4% |

Both sizes passed with eight managers and with 80 clients across ten leagues. All optimized
HTTP workflows completed successfully. Current-size workflow p95 improved from 750 to
399 ms with eight clients and from 4,685 to 2,817 ms with 80 clients. The larger historical
implementation timed out, so its timeout duration is not a successful latency baseline.
These workstation results establish regression evidence, not production capacity.

Evidence is written to ignored `test-results/supabase-optimization/api-benchmark.json`.
`--correctness-only` writes a separate `api-correctness.json` without replacing benchmarks.
The real HTTP checks reproduce all 16 original policy warnings before upgrading and zero
afterward, comparing 18 caller/role combinations. They cover notification ownership and
exact unread counts, catalog invalidation, unchanged snapshots skipping ADP, set-based
participation equivalence, revoked sessions, missing eligibility and deleted accounts.

The affected SQL suites pass 629 assertions. The existing `150-game-lineups-schedules`
suite has two baseline failures, assertions 48 and 58, concerning postponed/rescheduled
lineup unlocks. The isolated metadata recovery check passes without changing application
rows. Real HTTP draft controls and concurrent picks/queues/workers also pass.

The complete repository check has unrelated baseline limitations: 123 unchanged files fail
Prettier, and five import tests fail because required private hockey roster CSV fixtures
are missing. Changed files pass formatting. Record individual lint, SQL syntax, type,
domain, boundary, browser, Auth/admin and web/mobile export results separately rather than
claiming that `pnpm check` passed.
The general UI browser suite also requires the missing private fixtures. The draft,
varsity/transactions and public launch browser suites pass, including hidden-tab polling,
responsive layouts and the affected accessibility checks.

## Installed release on October 22, 2026

All five database stages were applied and fingerprint-verified. Advisors were rerun after
each stage: all 16 supplied performance warnings and both function-grant warnings cleared.
The automatic-RLS probe passed. Only the three intended existing function bodies changed;
their identities, owners and grants were retained. Only the event-trigger execution grants
changed. Worker commands and schedules were identical, every public table retained RLS,
and the single public draft-status signature was preserved.

The existing Vercel project now serves deployment
`dpl_5Ndi9JZieiYSdWgPzt3UkVT4pncy` at `https://play.brockfantasy.ca`. The exact local working
tree was uploaded without committing or pushing. The production build and public sign-in,
signed-out session and anonymous API-denial checks passed. Alternate deployment hostnames
remain denied by the application's origin policy. The previous READY production artifact
is `brock-fantasy-5hmlng4pp-ty-mabees-projects.vercel.app` for application-only recovery.

At 19:07 UTC, there were no active drafts, Tarik's deleted league remained absent, and
the 23 autopick and five reminder runs since the recovery capture had zero failures.
The statistics reset timestamp was unchanged. This is an early health observation;
representative production performance remains an observation gate.

The operator confirmed on October 22 that Brock Sports Fantasy uses Supabase Free.
Leaked-password protection therefore remains an accepted exception under the existing
no-upgrade constraint. It is the only remaining advisor warning; no billing or Auth
configuration was changed.

The operator will perform real-account commissioner acceptance in a separate test league.
That check remains pending until results are reported. The connected browser runtime failed
to start, and local fixture sessions were not used to impersonate a production user.
Native device behavior remains a separate pending check.

Commissioner acceptance checklist:

- Open a separate test league and verify notifications and player details load correctly
- Resume a fresh draft and confirm the timer starts with the configured duration
- Pause partway through a pick and confirm the timer remains frozen and picks are disabled
- Resume and confirm the saved time continues rather than restarting the full timer
- Hide the browser tab, return, and confirm the draft immediately shows the current state
- Sign out and, if available, switch accounts and confirm previous account data is cleared

Report the test league URL, approximate test time and any failed step without sharing
passwords, session cookies or tokens. Keep real-group drafts outside this acceptance check.

## Production procedure

Use the already linked project `fdovowiihxowzatewxgv`. Keep linked CLI calls sequential.

1. Produce an encrypted offsite backup and complete the isolated database restore drill
2. Finish local checks and choose a fresh private recovery directory
3. Capture metadata and the query-statistic baseline with `--capture`
4. Apply the five independently guarded stages with `--apply`
5. Deploy the compatible application to the existing Vercel project
6. Use a legitimate signed-in commissioner session in a separate disposable test league
7. Inspect query-statistic deltas, application errors and worker results during normal use

```powershell
pwsh -NoProfile -File scripts/backup-brock-supabase.ps1 -CopyOffsite -VerifyRestore
pwsh -NoProfile -File scripts/verify-brock-backup-restore.ps1 -Source Offsite
$env:BROCK_OPTIMIZATION_RECOVERY_DIR = 'D:\Brock Fantasy\Private\supabase-optimization-<release>'
node scripts/rollout-supabase-optimization.mjs --capture
node scripts/rollout-supabase-optimization.mjs --apply
```

The script refuses active drafts, transactions older than ten seconds, stale recovery
evidence, changed migration files, or an unverified backup. Each migration uses a two-second
lock timeout, a thirty-second statement timeout and an atomic migration-history entry.
It fingerprints every application table within the same transaction and permits only
the intentional pool revision increment. The grant stage also creates and rolls back a
probe table to verify automatic RLS. Advisor reports are retained after every stage.
Retries recognize only exactly matching installed stages.

Private evidence captures functions, identities, grants, policies, triggers, indexes,
worker definitions/schedules and query statistics. Do not commit that directory or copy
its contents into public reports. Do not reset `pg_stat_statements`; calculate deltas only
when the before/after reset timestamps match.

The signed-in acceptance check must exercise initial reads, notifications, player details,
pause/resume with a frozen timer, return from a hidden tab, logout and account switching.
Synthetic fixtures and a READY hosting deployment do not substitute for this check.
Physical native background/reconnect behavior also remains a separate device check.

## Recovery and risk

Overall production risk remains **medium**. Policy equivalence and catalog invalidation
have high potential impact despite the scoped changes. The small stages, short locks,
before/after checks and real API tests reduce the likelihood of broad access changes,
stale draft data or live request disruption. Production load testing is excluded.

For application rollback, retain the additive notification RPC and compatible table reads.
The private `recover-metadata.sql` restores original policy/function bodies and triggers
without restoring gameplay data or reintroducing the unnecessary execution grants. It
refuses active drafts. Review and record any executed recovery as a new forward migration.
Once gameplay has continued, preserve new picks and use a forward fix rather than an old
database snapshot.

Leaked-password protection remains disabled on the operator-confirmed Free plan. Retain
the explicit accepted exception and its advisor warning under the no-upgrade constraint.
If the subscription changes later, recheck availability before enabling the setting;
do not push the entire local Auth configuration.

The backup drill verifies encrypted offsite exports and an isolated database restore.
It does not prove a complete hosted Auth/application recovery, and the recovery key in
this drill came from workstation protection rather than an independently retrieved key.
