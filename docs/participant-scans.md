# Shared participant scans

The participant admin page keeps manual search and the existing audited correction
command. The directory and scan panels share private database state. A scan never
classifies an account, changes league rules, or changes earned points. Clicking an
unresolved match loads the current profile and prefills unsaved role/program edits.

## Reference publication

Run from the application checkout. Source CSVs, mappings, suppression files, generated
previews and receipts must remain outside Git and browser output.

```powershell
pnpm import:participant-references
```

The default preview reads the six current athlete roster files and six `Untitled`
staff/coach files under `logic/`. Blank separator rows are ignored. Staff `*` markers
remain in evidence, while names used for matching have the marker removed. All
staff use the existing `coach` role. Athlete `**` markers and retained suppressions
exclude a name from matching. Rows after a last-season marker are excluded.

An apply requires an explicit reviewed suppression file, including when the list
is empty. Use the existing retained opt-out inventory rather than inventing an
empty list to bypass this requirement. The file has this structure:

```json
{ "athletes": [{ "program": "mens_hockey", "name": "Synthetic Excluded Player" }] }
```

Duplicate names remain separate by default. Inspect `duplicates` and source rows
in the preview. To combine verified affiliations, provide a private mapping JSON
array. Use the exact `members` keys from the preview and a permanent UUID for the
verified person. Reuse the same mapping on future imports.

```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "members": ["coach:mens_hockey:synthetic coach", "coach:womens_hockey:synthetic coach"]
  }
]
```

```powershell
pnpm import:participant-references --mappings <private-mappings.json> --suppressions <retained-suppressions.json>
```

Review the generated preview, then use its exact `contentHash` with the same files:

```powershell
$env:BROCK_PUBLISH_PROJECT_REF = '<explicit-linked-project-ref>'
$env:BROCK_PUBLISH_OPERATOR_PROFILE_ID = '<active-administrator-profile-uuid>'
pnpm import:participant-references --mappings <private-mappings.json> --suppressions <retained-suppressions.json> --apply --expected-hash <reviewed-content-hash>
```

`--season <season-uuid>` overrides the default 2026–27 season. Publication is an
operator-only private function, never an application API. It checks the exact
document hash and importer role, serializes with scans, publishes atomically, and
returns the version UUID. Invalid input rolls back. Repeating an unchanged import
returns its original version without reactivating an older version.

Reference IDs survive source row moves. Matching fingerprints exclude file hashes
and row locations, so moving a row does not invalidate an unchanged dismissal.
Name, email, role, affiliations, title or supporting-staff evidence changes do.

## Scoring and shared review

`beta_private.participant_scan_settings` holds the release gate, scoring version,
and weights. Initial weights are exact supplied email 100, normalized name 90,
supplied email-username similarity 80, inferred username 60, and storage minimum 35.
Fuzzy scores are rounded weighted trigram similarity. The maximum signal determines
the account/reference score; signals are never added together. Domain similarity
does not contribute. Names are case/accent/punctuation insensitive and token order
is normalized. Username clues allow separators and trailing digits.

The default personal filter is 70. Lowering it reveals weaker saved matches without
running another scan. Profile rows use the best non-dismissed match and expand to
show alternatives. A dismissal affects one account/reference evidence pair, is
shared with other admins, requires a reason, and can be undone. Review writes use
an expected review ID to reject concurrent edits. Scan and review commands retain
idempotency keys after uncertain outcomes.

The page refreshes every 15 seconds while visible and when it becomes visible.
Refreshing never replaces editor state or a selected historical run. Profile
selection reloads current values; changed identity/reference evidence requires a
fresh scan. Existing participation revisions reject stale corrections with PT409,
reload current values, and require the administrator to review again. There is no
automatic resubmission.

## Retention and erasure

`brock-participant-scan-retention` calls the private bounded cleanup hourly. It is
independent of the broader `retention_enabled` switch. It retains detailed runs for
90 days, except the latest completed run. Active unchanged dismissals survive until
undone or their evidence changes. Older review events expire after 90 days.

Cleanup uses the existing five-second/row-budget tree walker and scoped holds.
Examples of categories are `beta_private.participant_scan_runs` and
`beta_private.participant_scan_reviews`, with the record UUID as the hold key.
Unused old reference versions expire only when no retained scan uses them.
Hard account deletion cascades private match/review evidence; soft deletion clears
it immediately. Actor foreign keys become null and display “Deleted administrator”.
Existing account/season erasure replay traverses the new foreign keys. Routine audit
events contain IDs/counts/statuses, without duplicate names, emails or review reasons.

## Validation and release gates

```powershell
pnpm test:import
pnpm test:participant-scans:local
pnpm build:web
pnpm test:participant-scans:browser
pnpm check
```

The local database suite creates disposable databases and synthetic accounts. It
tests access/MFA, matching, reference publication, duplicate commands, shared
reviews, actual scan-lock contention, retention and erasure replay. It also records
a 10,000-account/2,000-reference benchmark and query plans under
`dev/tmp/participant-scans-local/`. The target is under five seconds. Reference GIN
indexes use `fastupdate=off`, since imports are infrequent batches and a fresh
pending list must not cause repeated sequential matching scans.

Browser checks use two synthetic admin contexts and shared fixture state. They cover
polling, dismiss/undo, preserved edits, stale revisions, multi-program suggestions,
history, and light/dark layouts at 320/390/768/1280/1440px. They do not establish
hosted session, MFA, CSRF or provider acceptance.

The migration installs scans disabled. Before hosted release:

1. Capture and verify the normal backup/restore evidence before hosted migration
2. Apply the migration and publish the reviewed reference preview
3. In a protected acceptance environment, enable scans for the two-admin journey
4. Verify real MFA sessions, forwarding/CSRF, shared scan metadata, another admin's
   review within 15 seconds, classification, concurrent conflicts and deletion
5. Confirm hosted query performance and the independent cleanup schedule/holds
6. Enable production scans only after those checks pass

The explicit operator toggle is:

```sql
update beta_private.participant_scan_settings set enabled = true;
```

Set it to `false` to stop new scans. Existing manual search, participation saves,
saved results and cleanup remain available. Restore the previous frontend release
if a complete UI rollback is needed. Keep the additive schema and participation
corrections; do not reset drafts, memberships, rosters or scoring to roll back scans.

## Local verification on October 27, 2026

- The focused database suite passes 297 assertions, plus real scan-lock contention,
  importer hash/publication and erasure replay checks
- The broader database run passes 903 assertions when the existing
  `150-game-lineups-schedules.test.sql` failure is excluded
- That schedule suite's four failures also reproduce against HEAD without the new
  migration, so they are not introduced by participant scans
- The final 10,000-account / 2,000-reference scan takes about 1.64 seconds locally
- Security advisors report no errors against the disposable migrated database
- Two-admin browser fixtures pass in dark/light themes at all five planned widths,
  with zero detected accessibility violations or page errors
- Domain tests pass all 51 cases; lint, TypeScript, SQL syntax, changed-file formatting,
  HTTP forwarding/CSRF, auth/boundary checks, web export, and Android/iOS exports pass
- Source staff emails are absent from the 64 inspected browser output files
- The repository-wide `pnpm check` stops on existing formatting issues outside this
  change; the broader import suite also has missing private source fixtures and an
  existing official-schedule assertion failure

At the end of the initial implementation, the supplied-file preview contained 154
separate references and five duplicate-name groups. Hosted publication and release
work had not yet been performed

## Production rollout on October 27, 2026

- Production already serves the participant-scan commit `648bb41` and subsequent league-explorer commit `1380784`
- Migration `20261027162933_shared_participant_scans.sql` is applied, including the independent hourly cleanup schedule
- The original two-athlete suppression inventory was recovered from the protected October 8 publication manifest and supplied explicitly to the importer
- All 154 references are published with preview hash `ce8049126df85d6d53f0497b06918e465d9559a7b3ac7ff9e6958c6a52be8524`
- The five duplicate-name groups remain separate under the documented default, with no inferred identity merges
- Hosted security advisors report no errors
- A transaction-only hosted database-role rehearsal verifies shared results between two admin identities, shared dismissal and undo, and a scan duration of approximately 57 ms
- Every rehearsal write, including temporary scan activation and review events, was rolled back
- The participant directory and manual correction tools have their hosted database support available
- The user confirmed that the production admin views load, and scans are enabled for the live shared acceptance test
- Activation was verified in a separate hosted query and recorded in the audit log
- The genuine two-admin browser scan/review journey remains pending, distinct from the completed database-role rehearsal
- Detailed receipts and reference evidence remain in protected local storage rather than Git or browser output

## Participant confirmation requests

The October 28 admin centre changes add per-account confirmation email requests and a shared Requests view. Recipients sign in to the focused confirmation page, submit their role/programs for review, and remain unclassified until an MFA administrator approves the exact reply. Approved Neither replies dismiss only the linked suggestion

Requests expire after seven days and share a per-account 24-hour send limit across administrators. The new release gate is installed disabled. See [admin centre improvements](admin-centre-improvements.md) for retention, concurrency, mail dispatch, and hosted acceptance details
