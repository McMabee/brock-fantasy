# Conflict retry recovery and automatic matchup release

The October 24 release replaces application-generated serialization failures with
HTTP 409 conflicts and creates league schedules automatically after the final draft
pick. Both database migrations and the production application are installed.

## Production evidence

- Project: `fdovowiihxowzatewxgv`
- Application: <https://play.brockfantasy.ca>
- Deployment: `dpl_B161sLdb7HGxtKoAmXu6v9Y2c3UE`
- Migration `20261024144817` changes only the reviewed error-code literals in twelve
  existing functions, retaining their identities, owners, configuration and grants
- Migration `20261024144819` installs private scheduling helpers and connects the
  canonical final-pick path after league activation
- Both migrations verified unchanged application-table fingerprints
- Fresh encrypted offsite backup exports were hash verified and restored into an
  isolated database before production changes
- The original looping backend was observed before the conflict migration; it no
  longer matched an active looping query afterward, so no unrelated connection was
  terminated
- Repeated live checks found zero remaining custom `40001` guards and no active
  lineup retry candidate, including at 15:33 UTC, more than twenty minutes after
  the first migration
- Worker commands and schedules were preserved
- Hosted sign-in and rules pages returned 200, the signed-out session returned a
  null user, and anonymous private API access returned 401
- The new deployment's runtime-log query for 15:25-15:40 UTC returned no records
  and no excluded intervals
- The staged deployment hostname returned the expected application-host denial
  before promotion; canonical-domain smoke checks ran after promotion

| League           | Added matchups | Total matchups | Active Week 1 pairings |
| ---------------- | -------------: | -------------: | ---------------------: |
| Young Adults     |             16 |             16 |                      2 |
| Beta Test League |              2 |             16 |                      2 |

The audited repair preserved existing matchup IDs, opponents and scores. Runtime
fingerprints also verified unchanged rosters, earned-point events, profiles and
other protected gameplay rows. League version/timestamp metadata and the repair
audit are the intentional associated changes.

## Behavior and compatibility

Application conflicts use `PT409`, retaining optimistic version/hash checks and
their existing messages. Web and native command results preserve status and error
code. Lineup saves have one pending attempt, retain their key after an uncertain
network outcome, and refresh once on a conflict without automatically resubmitting.
Unchanged saved rosters can retain local edits on the refreshed version; changed
rosters require explicit review and reload.

Draft access denials clear private draft state and halt background polling. Manual
retry and identity changes can resume it. Transient availability failures retain
backoff; a membership denial does not sign the account out.

Schedules use the existing round-robin ordering and regular-season limits. A
completed draft qualifies for a period only before its first scoring-game lock;
without known fixtures the period start is the fallback. The helper handles the
same final manager, commissioner and worker pick path and remains unavailable to
direct client execution. Older commissioner scheduling RPCs remain compatible and
return existing schedules without duplicate pairings.

## Verification

- 662 pgTAP assertions across all SQL suites other than the existing schedule-lock
  suite, plus registration, upgrade and concurrency checks
- 33 new assertions cover conflict-code contracts, helper privileges, preservation,
  repair rejection, cutoff boundaries, missing fixtures, supported league sizes,
  independent circle-method parity, and actual manager/commissioner/autopick
  completion
- `pnpm test:matchup-recovery:local`: real Auth sessions, PostgREST 14.5 direct and
  exported web HTTP 409 responses, foreign-owner denial, unchanged rejected saves,
  and a browser saving a legal starter/bench swap through the real API/database
- Draft browser checks: terminal denial stops requests and clears private state,
  explicit recovery, transient outage, reset redirect, commissioner/member controls
- Varsity browser checks: conflict edit retention, no automatic resubmit, stable
  uncertain-outcome key, one committed mutation, changed-roster review, automatic
  schedule status, dark/light layouts and zero accessibility violations
- 51 domain tests and four polling/single-flight tests
- Typecheck, ESLint, SQL syntax, changed-file formatting, web export, browser secret
  boundary verification, and Android/iOS exports
- Independent read-only Codex Security boundary and candidate reviews found no
  concrete surviving bypass or regression within this patch

## Remaining evidence and existing failures

The supplied CSV contains 1,000 lineup conflicts over 9.992 seconds. The reported
eight-million daily total and 134 draft membership failures were dashboard counts
provided by the operator, not independently reconstructed from the CSV. The raw
membership-event metadata was unavailable. Current owners have membership rows;
the historical cause of those 134 denials remains unconfirmed.

The `150-game-lineups-schedules` suite has four failing assertions: 48, 49, 50 and
58, concerning postponed/rescheduled lineup locks and substitution scoring. The
same four failures were reproduced on the pre-release migrations in a separate
disposable database with the historical error expectations restored. This release
does not change that lock/scoring implementation or claim a clean full repository
check. Earlier evidence listed only 48 and 58; the current baseline also fails 49
and 50.

Supabase advisors retain the existing disabled leaked-password-protection warning.
No billing or Auth security settings changed. Native exports are build evidence;
physical-device and real production-account acceptance remain separate checks.

The twenty-four-hour observation is pending completion. The read-only observer
samples custom-conflict guards, rollback counters and worker failures every fifteen
minutes. It runs on the workstation and needs the machine awake, network access
and valid CLI credentials. It does not independently count historical log errors
or send incident/recovery notifications.

The first sample at 15:36 UTC was healthy, with zero unsafe conflict guards and
zero worker failures. Its rollback counter matched the 15:33 UTC readback.

## Operations and recovery

Use `node scripts/rollout-matchup-recovery.mjs --verify` for current read-only
status. `--repair-preview` lists canonical repair plans; `--repair` requires fresh
verified backup/restore evidence and checks protected rows inside each transaction.
`--observe` retains bounded read-only samples for twenty-four hours.

Private captures, migration readbacks, repair assertions, the baseline failure
comparison and observation logs live under the existing private backup directory
in the `matchup-recovery-20261024` run. Do not commit that private evidence or Auth
tokens. Future changes must use new forward migrations. Application rollback must
retain the nonretryable conflict codes and all newly earned gameplay data.
