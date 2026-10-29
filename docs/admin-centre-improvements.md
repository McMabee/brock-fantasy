# Admin centre improvements

October 29 acceptance and release-control activation are recorded in
[the acceptance tracker](release-acceptance-2026-10-28.md), including the operator's
browser/accessibility confirmations and verified production email delivery

The October 28, 2026 changes refine the Brock interface and add operational history,
participant confirmation requests, multiple league filters, and season-aware admin
ranking review. This delivery contains code, migrations, documentation, and local
verification evidence ready for review

## Pages

- `/admin/syncs` separates player ingestion and Brock schedule jobs, with timing,
  outcomes, counts, sources, associated alerts, search, dates, and cursor pagination
- `/admin/alerts` starts with unresolved alerts and also exposes resolved history
- `/admin/audit` searches retained events by summaries, names, IDs, category, actor,
  affected item type, and Toronto dates; the dashboard contains only 40 events
- Details use desktop side panels and full-screen phone panels, with focus
  containment/restoration, Escape dismissal, and server-allowlisted metadata
- League filters combine selections within groups and intersect season/status/search
  groups; no selections means all, while first entry defaults to Current and Open
- League counts include every matching result against the global total; inspection
  uses teams, grouped saved photo rosters, standings, and period matchup tables
- Schedule filters combine programs, inclusive Toronto dates, search, and Needs
  review, with 25 fixtures per page instead of the previous silent 100-row limit
- Admin rankings show the current season and read-only known previous seasons
  Each sport has two position tables comparing independently ranked women and men
  Ties remain tied, while saved combined rankings and draft inputs remain unchanged
- New publications capture supporting display inputs; unavailable older ranking
  snapshots/statistics use `—`
- Supporting source statistics retain their prior-season label separately from
  supplied projections and do not change the ranking formula

## Participant confirmation

An MFA administrator sends one request from a current unresolved scan suggestion
The recipient preview uses the account email resolved by the server, never a
reference email or an editable recipient field

The account-service email links to
`https://play.brockfantasy.ca/participation/confirm/<request-id>`. The recipient signs
in to that account and submits their role/programs with an optional explanation
The focused page has no normal app navigation

A response does not classify the account. The shared Requests view allows an MFA
administrator to approve or reject the exact answer with an 8–500 character reason
Approval uses the existing participation correction and preserves historical scoring
The decision, classification, and any linked Neither dismissal commit atomically

Unanswered requests expire after seven days. Sending is limited to one request per
account per 24 hours across all administrators. Replacement supersedes the earlier
request; a current submitted reply must be reviewed before another request
Identity, reference evidence, match review, and participation revisions are checked
again before sending, accepting a response, dispatching email, and approving a reply

Request lifecycle and email delivery state remain separate. Provider acceptance is
not delivery. Existing suppression, signed webhooks, provider idempotency, leases,
five-attempt limits, and the 23-hour send window remain in force

Private request/reply evidence expires after 90 days of inactivity through an
independent bounded hourly cleanup honoring existing holds. Soft/hard account
deletion clears private evidence, including email jobs through the request foreign key
Routine audit records contain IDs/statuses rather than copied emails or explanations

## Database and HTTP boundaries

Apply these additive migrations before deploying the corresponding client/workers

1. `20261028210952_admin_operations_history.sql`
2. `20261028210953_participant_confirmation_requests.sql`
3. `20261028210954_admin_league_filters_and_ranking_history.sql`

Admin reads use public invoker wrappers around private guarded implementations
The data proxy explicitly allowlists the new reads. The command proxy explicitly
allowlists confirmation send/response/review and enriched publication arguments,
while retaining origin/CSRF checks

Recipients can read/respond only to their own request. Admin reads and decisions
require current application access, the administrator role, and AAL2 in the database
Worker recording functions are service-role-only. Private tables have RLS enabled
and direct access revoked

Old league query and ranking publication signatures remain compatible. Both ranking
publication commands deny historical writes. Supporting-statistic changes invalidate
an enriched preview without changing frozen draft inputs

Schedule invocations persist their start/finish, totals, each program's outcome and
timing, and alert links. Partial runs fail while retaining applied change counts
New invocations retire abandoned runs older than 15 minutes. Earlier source health
and audit evidence is labelled separately from complete run history

## Verification

```powershell
pnpm test:admin-centre:local
node --experimental-strip-types --test scripts/lib/admin-centre.test.mjs scripts/lib/admin-league-navigation.test.mjs scripts/lib/schedule-worker.test.mjs scripts/lib/privacy-service.test.mjs
pnpm test:admin:local
pnpm build:web
pnpm test:admin-centre:browser
pnpm test:admin-leagues:browser
pnpm test:participant-scans:browser
pnpm typecheck
pnpm lint
pnpm lint:sql
pnpm verify:web-env-boundary
pnpm smoke:mobile
```

The database harness creates disposable databases and synthetic identities, including
real competing send and approval transactions. Browser fixture evidence is under
`test-results/admin-centre/`, with dark/light themes at 320/390/768/1280/1440px
Report database, HTTP forwarding, browser fixtures, and actual provider acceptance
separately

### Local results on October 28, 2026

- Passed 1,096 pgTAP assertions across every database suite except
  `150-game-lineups-schedules.test.sql`, including the indexed audit cursor plan
- Passed real competing sends, approvals, and ranking publications, including
  shared send limits, immutable publication versions, and idempotent retry receipts
- Passed the local database security advisor at error level
- Passed 51 domain tests and all 15 focused admin/navigation/worker/email tests
- Passed the actual HTTP entry/export tests with synthetic upstream responses,
  including caller-token forwarding, exact command arguments, origin, and CSRF
- Passed the admin centre browser matrix in both themes at all five target widths,
  with 120 screenshots, no serious/critical Axe violations, and no runtime errors
- Passed the existing league inspection and two-administrator participant scan
  browser regressions
- Passed TypeScript, ESLint, SQL syntax, production web export, private environment
  boundary checks, and Android/iOS compilation and exports
- Passed formatting for changed implementation files; retained the two existing
  documentation edits without broad reformatting

The repository-wide checks are not completely green

- `format:check` reports 270 files, including existing files and the two edited
  documents; this delivery does not reformat unrelated files
- `test:import` passes 94 of 99 tests; four failures require the unavailable local
  `logic/Fall.Winter Brock Fantasy Information - Goalie stats.csv`, and the
  unchanged missing-fixture test expects an October 17 fixture to remain in the
  future after that date has passed
- The schedule/lineup SQL suite fails assertions 48, 49, 50, and 58 concerning
  replacement starts and roster locks; the same four failures were reproduced
  using only unchanged HEAD migrations, separately from the new migrations

The successful expanded database run can be reproduced with

```powershell
$env:BROCK_TEST_SQL_FILES = ((Get-ChildItem supabase/tests -Filter '*.test.sql' | Where-Object Name -ne '150-game-lineups-schedules.test.sql' | Sort-Object Name).Name -join ',')
$env:BROCK_TEST_ADMIN_CENTRE_CONCURRENCY = '1'
$env:BROCK_TEST_ADVISORS = '1'
node scripts/test-registration-migrations.mjs
```

Browser fixtures verify presentation and command contracts. They do not establish
hosted account behavior, SMTP delivery, provider webhook configuration, background
cron execution, or on-device native acceptance

## Release and rollback

The migration installs
`beta_private.release_controls.participant_confirmation_enabled` as `false`. Keep
it disabled until the hosted MFA, account binding, dispatch, and real email journey
passes after a separately authorized release. The existing `service_email_enabled`
gate must also be enabled for new requests

Before production migration, obtain fresh backup and restore evidence. Deploy the
database contract before its client/workers, verify member/AAL1 denial, confirm two
admins see shared replies, and test real recipient delivery, signed webhook, focused
sign-in return, response, and audited approval

Disable `participant_confirmation_enabled` before rolling back the email worker
This stops new requests and makes queued/leased confirmation messages unsendable
Keep the additive schema and approved participation corrections
The initial implementation delivery did not include commits, pushes, production
migration/deployment, or real email sends

## Production repair on October 28, 2026

The client at `20f90f2` reached production before its three database migrations
The resulting missing RPCs returned 404 responses for operations history, league
filtering, and admin ranking review. Existing ranking records remained stored

After separate release authorization, the three migrations were applied to
`fdovowiihxowzatewxgv`, bringing migration history to 60 entries. A fresh encrypted
backup was copied off-site, restored without cache, and checked by export hashes
The snapshot was also restored into an isolated database and its integrity matched
The restore harness now installs `pg_trgm` and `unaccent` before restoring indexes

Hosted read acceptance returned 15 leagues, 40 recent audit events, and 119 current
published ranking entries, with 119 athletes available in the review preview
The database-role rehearsal denied members and administrators without AAL2
Direct PostgREST checks resolved all seven new reads and denied anonymous access
Security advisors reported no errors. Confirmation email remains disabled

The dashboard correction adds a consistent 24px gap below the metrics and 22px
action headings separated by Brock-red underlines. Unavailable operations metrics
show `—`, and missing service updates show an explicit temporary-unavailability
message. A failed ranking read no longer appears as a historical read-only season

The expanded browser suite passed both themes at 320/390/768/1280/1440px, including
metric spacing, action headings, and missing-RPC presentation, with 140 screenshots
and no serious/critical accessibility violations or runtime errors. TypeScript,
lint, web export, HTTP proxy tests, private environment checks, and Android/iOS
exports also passed

Use `supabase/operations/2026-10-28-admin-centre-acceptance.sql` for a repeatable,
rolled-back database-role read rehearsal. It does not substitute for a genuine
signed-in browser/MFA acceptance journey

The UI correction was staged and promoted through Vercel deployment
`dpl_C6364Cdo9NNYG5dZ2rwx4Y8HsKFX`, based on `20f90f2` plus the local repair
The canonical host remains `https://play.brockfantasy.ca`; alternate deployment
hosts retain their application-level denial. Git history was not changed

Run `pnpm verify:admin-centre:hosted` before a related client release and after
promotion. It checks RPC resolution through PostgREST, anonymous denial through
both API boundaries, public shells, and the corrected dashboard asset, without
private account data or a user session
