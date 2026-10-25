# League entry and prior-session release audit

Audit date: October 25, 2026, America/Toronto

The roster recovery and late-entry database changes are live in Supabase project
`fdovowiihxowzatewxgv`. The late-entry application is deployed separately from the
privacy and scheduled automatic-draft client release, whose publication and
activation requirements remain open.

## Applied and verified

| Item                                            | Verified result                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BFA Team League recovery                        | All 49 supplied starter assignments match, including Benjamin Bonisteel in HK_DG and Ava Cruikshank on the bench                                                   |
| Draft and ownership                             | Eight managers, 80 original picks, 80 roster entries, and existing opponents preserved by transaction assertions                                                   |
| Week 1                                          | Four BFA pairings added, 28 total matchups, 35 snapshots for games whose locks have passed                                                                         |
| Scoring                                         | Zero BFA point events, pool still scoring-paused, future games continue using normal lineup changes and locks                                                      |
| Late entry                                      | Newest published calendar and approved pool selected on the server, stale pools rejected, regular-period entry frozen at actual draft completion                   |
| Final cutoff                                    | Eight managers use seven regular periods, other supported sizes use eight, playoff start closes entry, a missed final window stays ineligible after calendar edits |
| Migration inventory                             | All 53 local migration versions installed in production, no missing versions                                                                                       |
| Privacy and automatic-draft database interfaces | All three earlier pending migrations installed with protected gameplay fingerprints unchanged                                                                      |
| Optional activation                             | Automatic starts, required mode selection, service email, retention, fresh intent enforcement, and policy approval remain disabled                                 |

The recovery was previewed in a rolled-back transaction before committing. It
corrected only the approved managers' slots, moved displaced starters to bench,
and replaced only unscored Week 1 snapshots. The manager with no supplied changes
kept the existing roster. Upcoming games were not snapshotted early. Original
acquisition timestamps, draft timestamps, picks, teams and existing matchups were
checked inside the transaction. The private manifest and before/after evidence
remain outside Git under the existing private backup root.

A fresh encrypted off-site snapshot was restored to an isolated database before
rollout. This verifies logical database integrity, not a complete application
disaster-recovery journey or an independently retrieved recovery password.

The forward clock migration keeps the authenticated creation-context RPC stable
and uses one statement timestamp. The public RPC retains the project's invoker
boundary; private helpers have no direct client execution grant.

## Earlier session checked

The audit read the actual `Verify week 1 matchup confirmation` session
`01a16e48-b623-7db1-a71b-093c110b0b70`, including its later privacy and automatic-draft
plan, and checked its repository files and production state.

- Young Adults retains two Week 1 matchups and Beta Test League retains two
- No league without a completed current draft has any matchups
- No application routine retains a custom `40001` business-conflict guard
- The last bounded production check found no worker failures in fifteen minutes
- Draft denial, explicit retry, archived-draft redirects and conflict recovery
  passed browser regression checks
- The privacy/automatic-draft interfaces that were previously uninstalled are now
  installed, while their release controls remain off
- Both repositories' privacy client changes are built and staged for review

The four historical schedule-lock failures documented in
`matchup-recovery-2026-10-24.md` remain: assertions 48, 49, 50 and 58 in
`150-game-lineups-schedules.test.sql`. The fixture now explicitly publishes its
scoring periods, so the new eligibility guard introduces no additional failures
in that suite. This release does not claim to fix those historical lock defects.

## Deployment boundary

The live late-entry application uses an isolated checkout of `e9214ad` plus the
late-entry client changes. This keeps unapproved policy and service features out
of the public release while preserving all source changes in the main checkout.

- Initial live late-entry deployment: `dpl_6ZpsRzRseJevtq1LUf7GVQQusB98`
- Final late-entry deployment: `dpl_HdEUDrDPeKegiYxdqW3onNub4efr`
- Privacy application staging: `dpl_4JZqNBeU8FUHjKyHKQGAxpMFdKWR`
- Association privacy staging: `dpl_B9YJ72jgcFuEa6AiTWCynzTjUf8w`

Canonical `/auth` and `/rules` returned 200, the signed-out session returned no
user, and unauthenticated private data access returned 401. Alternate deployment
hosts retained the expected host denial. Bounded runtime logs for the initial
live release contained the expected smoke requests and no warning/error entries.

## Validation

- 814 database assertions passed across the full migration set excluding the
  separately reproduced historical schedule-lock suite
- After additional season-selection and cutoff cases, 88 assertions passed in the
  two changed creation/late-entry suites
- 275 automatic-draft/privacy assertions passed with a disposable PostgREST 14.5
  HTTP run: private preferences, prompt conflicts, duplicate workers, pause/resume,
  forty unique committed picks, no premature/historical matchups, maximum tick 394 ms
- Isolated deletion replay passed and tolerates repeat application
- Concurrency and upgrade checks passed for enrollment, roles, participation,
  joins and compatible schedule confirmations
- 59 cookie, privacy, keyboard, contact, ranking and league-creation browser checks
  passed, including current-season selection, stable retry keys and closed creation
- Varsity/lineup browser checks passed in both themes and four widths, with zero
  accessibility violations
- Draft-controls browser checks passed, including terminal denial and explicit recovery
- All 51 domain tests, TypeScript, ESLint, SQL parsing and changed-file formatting passed
- Browser/server secret-boundary verification passed
- Association formatting, server types, build, twelve tests, runtime checks and
  public-secret boundary passed
- Hosted Supabase security advisors reported no error-level findings

The full import test command remains blocked by missing private roster CSVs and an
existing official-schedule-sync assertion. Repository-wide formatting also flags
unchanged baseline files; changed files pass. Local database lint retains existing
warnings in older routines. The new creation-context clock warning was corrected
through a forward migration.

## Requirements still open

The earlier plan explicitly reserves policy approval for the operator. See
`legal-applicability-register.md` and `privacy-drafts-release-runbook.md` for the
wording, applicability, minor-participant, sender and provider evidence to review.
The policy/client staging releases have not been promoted to the public domains.

Service email still needs its worker/unsubscribe/webhook configuration, tracking
readback and actual inbox/bounce acceptance. Required automatic mode and automatic
starts stay disabled until hosted acceptance. Retention additionally needs the
copy inventory, holds and fresh deletion replay before activation. Representative
manual screen-reader acceptance and twenty-four-hour hosted observation remain
separate from the automated and immediate checks above.

No source files were staged, committed or pushed during this continuation. The
requested commit message is a draft for the inspected working tree.
