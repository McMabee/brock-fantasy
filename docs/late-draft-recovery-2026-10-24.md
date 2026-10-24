# Late draft start recovery

Tarik's BFA Team League could not start or schedule its draft on October 24.
Both installed commands retained a preseason-only cutoff: `start_draft` raised
`The season has started` after the first period began, while
`schedule_league_draft` required a planned time before that same boundary.
The season's first period began at midnight Toronto time, before the first
scoring game at 2 p.m.

The screenshot establishes HTTP 400 responses, without the underlying response
body. Source and live league inspection identified the conflicting guards; a
real local Auth/PostgREST 14.5 reproduction returned both exact messages.

## Change and production verification

Forward migration `20261024170758_allow_late_league_drafts` replaces those two
predicates with a private calendar helper. A league can start or plan a draft
while at least one approved regular-season period remains eligible. The helper
matches the automatic matchup calendar: the first seven regular periods for
eight managers, the first eight for other supported sizes, and a strict cutoff
at each period's first scoring-game lock. Missing fixtures use the period start.
Cancelled and postponed games cannot extend the window, and playoff periods
cannot admit a new draft. Only the bounded approved calendar is inspected; the
existing competition/time indexes support each scoring-lock lookup.

The migration preserves commissioner checks, app/session access, saved pick
duration, required rounds, full seats, legal roster matching, approved rankings,
idempotency receipts, locking, and nonretryable `PT409` conflicts. Public RPC
signatures, existing function identities, owners, security modes, search paths,
and grants are unchanged. The new helper has no execution grant for anonymous,
authenticated, or service clients. Legacy drafts without a combined pool retain
their existing start path.

The production rollout used a fresh encrypted offsite backup and a successful
isolated database restore. The transaction compared fingerprints of all public,
beta-private, and registration-private application tables before and after;
none changed. Only the two reviewed existing function definitions changed.
Migration history was recorded atomically. No application deployment was needed.

The immediate production readback found:

- BFA Team League remains in setup with eight teams and feasible legal rosters
- Its draft window is open, with zero drafts and zero matchups
- No league without a completed current draft has any matchups
- No application-generated `40001` guard remains installed

Tarik must refresh the league page and start the draft himself. This rollout
did not impersonate him or start his real draft. His successful production click
remains user acceptance. Matchups are created only after the final draft pick;
Week 1 eligibility still depends on completion before its first scoring lock.

## Regression evidence and operations

- 30 new pgTAP assertions cover late start/scheduling, strict cutoff boundaries,
  missing/cancelled fixtures, period limits, playoff exclusion, grants,
  commissioner access, stale conflicts, full seats, approval, saved duration,
  idempotent retries, finished-season rejection, and no premature matchups
- The selected migration suite passed 692 assertions plus concurrent enrollment,
  participation/join, and compatible schedule-confirmation checks
- The known unrelated `150-game-lineups-schedules` baseline suite remains
  excluded from that count, as documented in the earlier matchup recovery report
- Real Auth/PostgREST HTTP reproduced both old errors, then accepted late
  scheduling/start while preserving permission, round, date, conflict, retry,
  and no-premature-matchup behavior
- JavaScript lint, formatting, and SQL syntax checks passed

Run `pnpm test:late-draft:local` against the migrated local stack. To reproduce
the old behavior and test the transition on a local stack that has not received
this migration, use `node scripts/test-matchup-recovery-local.mjs --rest-only
--late-draft --prove-upgrade`. These tests are restricted to localhost and use
temporary Auth accounts and league fixtures.

`node scripts/rollout-late-draft-recovery.mjs --verify` rechecks the installed
migration and live invariants. `--apply` checks verified backup/restore receipts,
refuses active drafts, takes a short table lock, verifies unchanged gameplay
rows, and applies only this migration. It verifies an already installed migration
without applying it again. Evidence is stored privately in the
`late-draft-recovery-20261024` directory beneath the existing private backup root.
Do not commit private captures, exports, or credentials.
