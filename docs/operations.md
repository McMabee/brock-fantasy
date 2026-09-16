# Operations and Release

This is the execution runbook for the unfinished items in `docs/release-readiness.md`. That file is
the canonical checklist; this file supplies the environment, deployment, scheduling, monitoring,
backup, incident, and game-day procedure. Record commands, approvers, timestamps, artifact IDs, test
results, and rollback references in a release record for each staging or production promotion.

## Responsibility and release records

Before creating production access, assign the owners listed in the release-readiness checklist and
record primary/backup contacts plus escalation paths. Use least-privilege named accounts, require MFA
for provider, Supabase, Expo, Apple, Google, DNS, and monitoring consoles, and review access before
each release. Never put tokens or recovery codes in the repository or release record.

Each release record must identify the immutable commit, selected feature scope, environment, database
migration version, ruleset/provider-data versions, web/mobile artifact IDs, approvals, test evidence,
backup/restore evidence, known issues, go/no-go decision, monitoring window, and rollback owner.

## Environments

Use separate Supabase projects for staging and production and separate EAS channels/aliases. Local
development uses synthetic fixtures and no production secrets. Production configuration must set
the public Supabase values in EAS and server credentials in the Supabase secret store.
Add the production web reset URL and `brockfantasy://reset-password` to the Supabase Auth redirect
allowlist, and verify signup confirmation plus recovery on web and physical iOS/Android devices.
Enable TOTP enrollment and verification in both hosted projects. Granting the database `admin` role
is insufficient by itself: administrator routes, RLS, and Edge commands require an AAL2 session.

### First-time hosted setup

1. Obtain rules, provider/data rights, brand, privacy/legal, support, accessibility, and operational
   approvals; do not substitute synthetic values.
2. Create staging and production Supabase projects, the EAS project, protected EAS channels, DNS/TLS,
   Apple and Google app records, monitoring, and status/support channels.
3. Replace the EAS project placeholder in `apps/client/app.json`, confirm the owned iOS/Android
   identifiers, and configure public client variables from `.env.example` separately per environment.
4. Put the provider token/webhook secret, Supabase service role, signing and push credentials only in
   their hosted secret stores. Verify the built client contains no server credentials.
5. Link the environment, apply migrations, deploy all Edge Functions, configure Auth/email/TOTP and
   redirects, create named AAL2 administrators/review accounts, and run database/Edge smoke tests.
6. Load approved rules, teams, athletes, schedules, games, provider mappings, autopick rankings, and
   sponsor campaigns. Reconcile row counts and sampled identities with the data owner.
7. Configure recurring jobs, backups, logs, dashboards, freshness/error alerts, on-call routing, and
   status communication. Witness a restore and rollback/forward-fix rehearsal before launch.
8. Deploy a staging web preview, run the full release evidence checklist, and promote the exact tested
   commit only after recorded approval.

### Provider ingestion and manual imports

Implement the selected provider behind `SportsDataProvider`; the repository does not contain a
provider-specific roster/schedule/stat client because no sanctioned API contract was supplied. Use
webhooks where supported or short scheduled Edge invocations within the approved polling/rate limits.
Authenticate requests, retry with bounded backoff, alert on stale/failed runs, and pause only affected
competitions during an outage.

Automated feeds, administrator JSON imports, and the remaining CSV adapter must all produce the same
canonical payload and enter `ingest-sports-data`. Preserve the pre-validation receipt, validate and
map IDs, normalize, replay, audit, and then publish committed results. Never write normalized stats
or point totals directly. Test duplicates, corrections/reversals, malformed/partial data, unknown IDs,
postponed/cancelled games, rate limits, and delayed finalization in staging.

### Competition activation and recurring jobs

Before enabling a competition, confirm its ruleset is approved, provider mappings are verified,
athlete content is authorized, historical golden tests pass, and an operations owner is assigned.

After applying migrations, load and review a complete `athlete_rankings` list for every active
competition. Schedule `select public.process_expired_drafts(25)` through Supabase Cron every 10
seconds in staging and production. Prove queue-first selection, rankings fallback, concurrent worker
execution, and the no-eligible-athlete pause before enabling drafts. The job is intentionally not
created by migration so each environment has an explicit, independently pausable release control.
Also schedule `select public.advance_matchup_periods(100)` once per minute and
`select public.expire_trades(100)` once per minute, plus
`select public.process_due_waivers(<league-id>)` according to each approved league ruleset. Alert on
paused drafts, failed sync runs, unresolved mappings, and matchup periods that cannot finalize.
Invoke `dispatch-push-notifications` with the service role on a short schedule after mobile push
credentials are installed. Monitor failed tickets/receipts and disabled device tokens; the in-app
notification inbox remains authoritative when external push delivery is delayed.

For every scheduled job, record its environment, cadence, authentication method, timeout, retry
policy, alert threshold, owner, and pause/resume procedure. Run overlapping invocations in staging to
prove database locking/idempotency before production. Review job history and ingestion freshness at
the start and end of each game-day window.

## Deployment

1. Merge only a green pull request. Add protected deployment automation and deploy a staging web
   preview; the current CI workflow verifies artifacts but does not publish them.
2. Apply migrations to staging, run smoke/E2E tests, and verify the migration rollback or forward-fix.
3. Back up production before a risky migration.
4. Promote the tested EAS web deployment only after manual approval.
5. Build signed mobile artifacts from the exact tested commit and upload them with EAS Submit.

Before web promotion, verify production configuration rejects demo mode; privacy, terms, support,
deletion, and delayed-data/status pages are approved; email confirmation/recovery works; custom-domain
DNS/TLS is healthy; monitoring is receiving events; and the previous build/database recovery path is
available. After promotion, run authentication, league read-only, ingestion, notification, and admin
AAL2 smoke checks, then observe the recorded release window before closing the release.

## Monitoring and support

Alert on authentication failures, provider freshness and schema errors, unresolved mappings, failed
syncs/replays, paused drafts, expired draft timers, waiver/trade/matchup worker failures, Edge errors,
push receipt failures, elevated API latency/error rate, database capacity, backup failures, and
security/audit anomalies. Do not send personal data, secrets, raw provider credentials, or chat bodies
to monitoring unless privacy approval explicitly permits it.

Support procedures must cover verification/recovery, invite access, disputed scores, draft reconnects,
moderation reports, push failure, and deletion requests. Authenticate the requester, use audited
commands, preserve scoring integrity, and escalate provider/rules disputes to the named data owner.
Publish a delayed-data message when scoring freshness exceeds the approved threshold.

## Game-day checklist

Before: verify provider health, game/team/athlete mappings, approved ruleset, clear ingestion backlog,
and a successful recent backup. During: watch provider timestamps, sync errors, scoring errors, and
spot-check official stats. After: wait for the approved finalization signal, reconcile totals, and
monitor later corrections.

## Scoring incident

Pause only the affected competition, preserve raw inputs, identify games/leagues, correct mapping or
normalization/rules, replay from the immutable snapshot, compare totals to golden expectations,
communicate user-visible changes, and write a postmortem. Never edit point totals directly.

## Backup and restore gate

Configure automated database backups and record retention, RPO, and RTO after the production tier is
selected. Before public launch, restore the latest backup into an isolated project, run integrity
queries and critical E2E tests, record duration/results, and verify the production rollback procedure.

Test restore credentials and integrity queries without relying on the failed primary environment.
The release record must identify the backup restored, isolated target, start/end time, observed RPO
and RTO, test results, cleanup owner, and approval. A backup that has not been restored is not release
evidence.

## Mobile beta and submission

Use separate internal/preview testing before production signing. On physical iOS and Android devices,
test signup/verification/recovery deep links, TOTP administration, league invites, draft reconnect,
lineup locks, push permission/delivery/receipts, accessibility, text scaling, network loss/recovery,
and account deletion. Record TestFlight and Play internal-test versions and tester sign-off.

Build the `.ipa` and `.aab` from the same approved commit and production environment. Verify version,
package IDs, signing, icons, screenshots, store copy, support/privacy/deletion links, privacy labels,
Google Data Safety, review notes/accounts, and rights declarations before EAS Submit. Upload readiness
by October 30 is controllable; Apple/Google review completion is not.

## October release cutline

If safe-core hardening lacks three uninterrupted days, defer chat, sponsor metrics, waivers, and
trades in that order. Never cut authorization tests, account deletion, score replay/corrections,
draft integrity, monitoring, or restore verification. If those gates fail, delay public release.
