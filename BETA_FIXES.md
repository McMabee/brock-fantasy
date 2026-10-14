# October 14 beta fixes

Implemented and validated locally on October 14, 2026 (America/Toronto). Hosted database publication and deployment are pending. Existing hosted readback still has 120 active athletes, no published heights, and migrations through `20261013233622`.

## Behavior

- League Settings contains manager team-name editing, lineup/transaction/account actions, draft results, and the complete commissioner controls. Commissioner controls render only for the commissioner; existing server authorization remains enforced. Team-name writes are restricted to the caller's own team and support audited, idempotent retries.
- Completed drafts redirect to a separate results page. Their room snapshot returns only closure metadata, without queues, player catalogs, rosters, picks, or legal candidates. Results require membership in that league. All room-entry links account for draft status.
- League roster rows use athlete photos with initials when no image is available, and identify the athlete's program, position and assigned fantasy slot. Player profiles also identify the program.
- The directory, player profile, draft list and draft detail panel display projected season fantasy points, heights and ADP. Player reads tolerate a database that has not yet acquired the new ADP column/RPC, so an unavailable optional metric cannot break the roster list.
- Program rows on the dashboard show the next scheduled/current game time in Toronto's timezone. Notification filters have space below them; footer links align; long action labels wrap within phone widths.

## ADP and supplied data

The supplied ADP counts as one starting observation. Each persisted pick from a completed, unvoided draft in the same season pool contributes its overall pick number, across all leagues and league sizes. Manual and automatic picks count. The existing beta sets `is_test=true` on every draft; these completed beta drafts now count too. In-progress and voided drafts do not count.

`ADP = (supplied ADP + sum of recorded overall picks) / (1 + number of recorded picks)`

For an athlete without a supplied value, use the observed average; with neither a seed nor a completed pick, display an em dash. The database computes this from persisted draft history, so repeated reads and command retries cannot count a pick twice. Voiding/deleting a draft removes its contribution. Snapshot revisions include the aggregate, allowing other leagues' completed drafts to refresh player ADP in an open room.

The prepared roster transaction updates 119 existing athlete identities, 110 supplied ADPs, season projections, historical numeric columns, and 59 verified heights. Nine supplied ADPs and 60 heights are unavailable. No missing number is invented. Supplied heights take precedence; otherwise the existing verified current-season official mapping supplies them.

The operator explicitly confirmed that the missing men's basketball athlete is an opt-out. Publication hides that identity from participant catalog, player, ADP and photo reads, disables drafting, and removes queued references. Historical picks and ownership remain intact; results and lineups mask the withdrawn athlete's name/photo. The two earlier source opt-outs remain suppressed.

The crosswalk checks program, name, jersey, positions, eligibility, study program and hometown against the original protected publication receipt. Changed row numbers retain the original athlete ID and roster-source mapping. Unknown, duplicated, changed or unexplained missing identities fail before publication. New source hashes/row numbers are recorded as metric provenance. Raw rosters, receipts, withdrawal evidence and publication SQL remain under the ignored `logic/` and `dev/` directories.

## Evidence

- Formatting, ESLint, SQL syntax and TypeScript checks passed. Domain tests: 40. Script/import tests: 64.
- `pnpm test:roster-metrics:local`: 465 pgTAP assertions on isolated databases, guarded publication/readback/retry, stable IDs/headshots/source mappings, one withdrawal, and pool invalidation. Database fixtures roll back and temporary databases are dropped.
- The isolated migrated database's Supabase security advisors returned no error-level findings. This is separate from hosted advisor/release validation.
- `pnpm test:ui`: both themes, player/draft screens at 320/390/768/1024/1440px, Settings/roster/notifications at 320/390/1440px, commissioner versus manager visibility, own-team rename, completed-draft redirect/results, optional ADP outage, game times, notification spacing and footer alignment. There were zero browser errors and zero axe violations in the player-page checks at 390/1440px. The suite generated 64 screenshots using controlled APIs, not hosted accounts.
- Web export, browser/server secret boundaries, public API/auth outage checks, web Auth/admin regressions and Android/iOS exports passed. Native exports do not establish real-device acceptance.
- Browser report: `dev/tmp/ui-refresh/report.json`. Publication rehearsal: `dev/tmp/roster-metrics-rehearsal/readback.txt`. The original height-only publication rehearsal also passed.
- Read-only hosted preflight matched all 120 canonical IDs/source bindings, confirmed the prepared publishing operator is an active administrator, and found the original 40 picks intact. `dev/tmp/roster-metrics-publication/hosted-preflight.txt` records that result; no hosted application rows were changed.

## Hosted release

1. Complete the existing backup/restore release gate and review the migration and protected metric plan. Apply both pending migrations, `20261014151316_player_display_metrics.sql` and `20261014210528_league_settings_and_live_adp.sql`, to the intended beta project.
2. Run `pnpm import:player-metrics` with the actual publishing administrator UUID in `BROCK_PUBLISH_OPERATOR_PROFILE_ID`. The command generates `dev/tmp/roster-metrics-publication/plan.json` and `publication.sql`; it does not apply SQL. It uses the original protected roster plan through `BROCK_PUBLISHED_ROSTER_PLAN`, or the October 8 publication receipt by default, and the retained October 14 suppression record.
3. Apply the reviewed transaction using the explicit linked project and retain readback. Expect 119 participant-visible active athletes, 110 supplied ADPs and 59 populated heights, with the original identities, photos and picks preserved. Verify the canonical data/provenance and seed-plus-history ADP through an ordinary AAL1 account.
4. Deploy the reviewed export and perform hosted manager/commissioner acceptance, including a completed draft URL, separate results, and ADP after another league completes a draft. Local mocked-browser evidence does not establish this hosted journey.

No commit, staging, push, hosted migration, hosted data mutation or deployment was performed in this implementation.
