# Privacy and automatic-draft release runbook

October 29 activation: the operator reported acceptance passed and explicitly
confirmed policy/source-rights and retention inventory review. All seven release
controls are now enabled. See [the acceptance and activation record](release-acceptance-2026-10-28.md)
for deployed configuration, backup/restore, delivery evidence, and remaining
operational follow-up. The migration defaults described below remain intentionally
disabled for a new installation

## Current release boundary

The three forward migrations install compatible interfaces and leave automatic
starts, required mode selection, mail delivery, retention and policy approval off
Existing active/completed drafts remain live mode, with picks and scoring preserved
Clients must be deployed after the database interfaces are installed
Do not enable automatic starts before hosted acceptance

## Evidence and staged activation

1. Review `legal-applicability-register.md` and all concrete policy drafts
   Record approval, owner, effective date, meaningful-consent treatment for eligible
   17-year-olds, sender information and processor locations
2. Capture and verify a fresh encrypted backup, off-site readback and isolated
   database restore using the existing backup scripts
   A READY deployment or copied export is insufficient
3. Apply the three new migrations in order, run database grants/advisors and verify
   active draft IDs, pick counts, point totals and worker health before/after
4. Deploy the clients, then verify sign-in after rejecting preferences, withdrawal,
   contact failure/retry, protected draft preparation, keyboard and screen-reader
   behavior, phone/desktop spacing, both themes and 200–400% zoom
5. Configure private service-mail variables from `.env.example`
   Keep `SUPPORT_EMAIL_TO` internal; the public contact is Ty only
   Verify Resend domain tracking remains off and register the delivered/bounced/
   complained webhook at `/api/service-email/webhook`
   Store its signature secret privately
6. Configure `pg_net` and Vault if absent, and insert the canonical worker URL
   `https://play.brockfantasy.ca/api/service-email/worker` as the Vault secret
   `brock_service_email_worker_url`
   Use the same random worker credential in Vault's
   `brock_service_email_worker_secret` and Vercel's `SERVICE_EMAIL_WORKER_SECRET`
   Never put credentials in cron text or log request headers
7. Enable service mail only after a controlled hosted acceptance test can be run
   Verify real operator contact receipt, manager schedule/reminder/block/completion
   receipt, provider events, suppression and account-free unsubscribe
   Provider acceptance alone is not inbox delivery
8. After hosted automatic-draft acceptance, enable `automatic_drafts_enabled` and
   `mode_selection_required` in `beta_private.release_controls`
   Test a disposable league through completion and verify no early matchups,
   actual-completion scoring eligibility, worker recovery and unchanged live fallback
9. Activate retention separately after the inventory, hold and restore checks below
   Enable `fresh_command_keys_required` only after all clients issue `bf2` intents
   Old existing receipts remain recoverable; new legacy or expired intents get PT409
   Receipt disposal remains off while the fresh-key control is off
10. Observe immediate worker/mail/privacy health and the next 24 hours
    Record concrete failures and recipient delivery evidence

## Retention inventory and controls

`beta_private.process_retention(100)` runs hourly with a five-second work budget and
a total row-deletion budget, traversing incoming foreign keys in bounded batches
It resumes partially cleared dependency trees without a large parent cascade
The job is serialized with an advisory lock and disabled by default
Inventory external copies before activation: operator mailboxes, Supabase logs and
snapshots/PITR, Vercel/Better Stack logs, temporary exports, local and off-site restic
repositories and source spreadsheets
Provider limits are separate acceptance evidence and cannot be enforced by database SQL

- Private rankings/snapshots: completion/cancellation plus 30 days
- Notifications, delivery records, limiter records and operational run summaries: 90 days
- Disabled push tokens: 30 days after disabling
- Ordinary chat: 12 months; open/recent moderation evidence is preserved
- Moderation/privacy cases: closure plus 24 months; support: closure plus 12 months
- Verification evidence: verification plus 30 days
- Breach records: at least 24 months from determination, and until the case is closed
- Audits: 24 months, subject to documented replay/legal holds
- Unverified accounts: registration plus 30 days
- Inactive accounts: two years without sign-in or session refresh, no active league
  obligation or administrator role, actual notice acceptance and at least 30 further days
  A bounced/suppressed notice never qualifies an account for automatic deletion
- Manager-linked league history: 24 months after recorded season finalization
  No historical finalization date is invented
- Season-scoped source/athlete records: covered season end plus at most five years
  Shared source assets need entries in `beta_private.source_asset_expiry`, including
  reviewed end date, licence limit and reason, and are not removed while used in a
  current season or league
- Unused preview/rejected imports: 90 days unless held for review
- Replay receipts: closed competition plus 90 days, gated by fresh intent enforcement
- Erasure ledger: 90 days; encrypted backups: existing stricter 30-day limit
- Temporary exports: task completion plus at most 30 days, recorded in the copy inventory

For holds, use the exact relation category (for example `public.chat_messages`) and
record UUID; roots use `account`, `league`, `source_import` and `season`
Snapshot hold keys use `draft_uuid:team_uuid`, preference keys use `team_uuid`, and
receipt keys use `user_uuid:command:intent_key`
Other compound-key rows use their JSON row key unless a whole-category
`record_key='*'` hold is appropriate
Keep holds restricted, scoped and justified, with an actual expiry and a review at
least every 90 days
Use `beta_private.retention_cases` for closed request/incident evidence
Do not copy removed payloads into `retention_runs` or disposal logs
Verify preview counts and a representative held and expired record before activation
Unknown historical end dates and unreviewed source rights require operator review

## Deletion replay before restoring service

Keep the restored environment offline
Freeze relevant writes, export a fresh ledger from the live source into a private
path outside Git with `node --experimental-strip-types scripts/export-erasure-ledger.mjs <absolute-private-path>`
Set `BROCK_ERASURE_MANIFEST_PATH` to that private file when running
`scripts/verify-brock-backup-restore.mjs`
The manifest must be less than one hour old and contains only necessary root IDs
The restore script replays account, league, source-import and season removals in
the isolated container and fails if dependency cleanup cannot finish
Do not return a restored database to service until current deletions are replayed
and application/Auth/draft/scoring acceptance also passes
An older manifest inside a backup cannot represent deletions made after that backup

## Rollback

Set `automatic_drafts_enabled=false` to prevent arming and new automatic starts
Already committed automatic runs remain resumable through the controlled worker and
audited pause/resume/reset path; never delete committed picks to roll back a client
Disable `service_email_enabled` or `retention_enabled` independently when necessary
Retain corrected PT409 conflict codes and compatible database functions
Do not restore old data over newer scoring or deletion decisions
