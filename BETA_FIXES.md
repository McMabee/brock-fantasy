# October 14 beta fixes

Implemented on October 14, 2026 (America/Toronto). The hosted database now includes both October 14 migrations and the guarded roster-metrics publication. After the operator completed the CSV updates, readback confirms 119 visible eligible athletes, 119 supplied ADPs, 59 verified heights and the original 40 picks. The withdrawn athlete is inactive, hidden, absent from ADP and has no queued selections; an authenticated AAL1 profile read returns no record.

The screenshot follow-up fixes the league roster query's ambiguous competition embedding by naming its direct foreign key. Lists retain separators between entries and omit the last separator, including after filtering. The weekly forecast and Back to players action now have a 20-pixel gap. Directory sorting caches supplied metrics and search text, and game scoring aggregates events in one pass.

## Behavior

- League Settings contains manager team-name editing, lineup/transaction/account actions, draft results, and the complete commissioner controls. Commissioner controls render only for the commissioner; existing server authorization remains enforced. Team-name writes are restricted to the caller's own team and support audited, idempotent retries.
- Completed drafts redirect to a separate results page. Their room snapshot returns only closure metadata, without queues, player catalogs, rosters, picks, or legal candidates. Results require membership in that league. All room-entry links account for draft status.
- League roster rows use athlete photos with initials when no image is available, and identify the athlete's program, position and assigned fantasy slot. Player profiles also identify the program.
- The public Rules page explains league setup, starter and bench roles, every slot's eligible positions, snake drafts, period locks, scoring coefficients and bonuses, waivers, trades, projections and ADP. It links from the footer, dashboard, league overview/Settings/roster, league creation, draft, lineup and player details. Contextual links open the matching topic.
- The beginner roster shows all six named starter slots, eligibility, empty spots and a separate bench with capacity and scoring guidance. Lineup controls use full labels and can swap compatible unlocked athletes in a full roster before saving; locked athletes remain protected by the existing server validation.
- Player sorting offers explicit Name, Projected FP and ADP choices. Names are alphabetical, projections highest first and ADP lowest first, using the current draft-adjusted average with the supplied seed as the availability fallback. Unavailable values sort last and equal numbers use alphabetical names.
- The directory, player profile, draft list and draft detail panel display projected season fantasy points, heights and ADP. Player reads tolerate a database that has not yet acquired the new ADP column/RPC, so an unavailable optional metric cannot break the roster list.
- Program rows on the dashboard show the next scheduled/current game time in Toronto's timezone. Notification filters have space below them; footer links align; long action labels wrap within phone widths.

## ADP and supplied data

The supplied ADP counts as one starting observation. Each persisted pick from a completed, unvoided draft in the same season pool contributes its overall pick number, across all leagues and league sizes. Manual and automatic picks count. The existing beta sets `is_test=true` on every draft; these completed beta drafts now count too. In-progress and voided drafts do not count.

`ADP = (supplied ADP + sum of recorded overall picks) / (1 + number of recorded picks)`

For an athlete without a supplied value, use the observed average; with neither a seed nor a completed pick, display an em dash. The database computes this from persisted draft history, so repeated reads and command retries cannot count a pick twice. Voiding/deleting a draft removes its contribution. Snapshot revisions include the aggregate, allowing other leagues' completed drafts to refresh player ADP in an open room.

The published roster transaction updates 119 existing athlete identities, all 119 supplied ADPs, season projections, historical numeric columns, and 59 verified heights. Sixty heights remain unavailable. No missing number is invented. Supplied heights take precedence; otherwise the existing verified current-season official mapping supplies them. Player profiles and draft details show the original supplied ADP separately from the displayed draft-adjusted average.

An independent audit reads each exact current CSV ADP cell using the source hash and row mapping, then compares it with the stored seed, aggregate seed and independently calculated completed-pick average. All 119 rows matched with zero missing/duplicate summaries or provenance/seed/average mismatches. Ordinary AAL1 reads returned all 119 seeds and aggregates, with 39 active athletes carrying completed-draft observations; the withdrawn athlete was absent.

The operator explicitly confirmed that the missing men's basketball athlete is an opt-out. Publication hides that identity from participant catalog, player, ADP and photo reads, disables drafting, and removes queued references. Historical picks and ownership remain intact; results and lineups mask the withdrawn athlete's name/photo. The two earlier source opt-outs remain suppressed.

The crosswalk checks program, name, jersey, positions, eligibility, study program and hometown against the original protected publication receipt. Changed row numbers retain the original athlete ID and roster-source mapping. Unknown, duplicated, changed or unexplained missing identities fail before publication. New source hashes/row numbers are recorded as metric provenance. Raw rosters, receipts, withdrawal evidence and publication SQL remain under the ignored `logic/` and `dev/` directories.

## Evidence

- Formatting, ESLint, SQL syntax and TypeScript checks passed. Domain tests: 40. Script/import tests: 64.
- `pnpm test:roster-metrics:local`: 465 pgTAP assertions on isolated databases, guarded publication/readback/retry, stable IDs/headshots/source mappings, one withdrawal, and pool invalidation. Database fixtures roll back and temporary databases are dropped.
- The isolated migrated database's Supabase security advisors returned no error-level findings. This is separate from hosted advisor/release validation.
- `pnpm test:ui`: both themes, player/draft screens at 320/390/768/1024/1440px, Settings/roster/notifications at 320/390/1440px, commissioner versus manager visibility, own-team rename, completed-draft redirect/results, optional ADP outage, game times, notification spacing and footer alignment. There were zero browser errors and zero axe violations in the player-page checks at 390/1440px. The suite generated 64 screenshots using controlled APIs, not hosted accounts.
- Web export, browser/server secret boundaries, public API/auth outage checks, web Auth/admin regressions and Android/iOS exports passed. Native exports do not establish real-device acceptance.
- Browser report: `dev/tmp/ui-refresh/report.json`. Publication rehearsal: `dev/tmp/roster-metrics-rehearsal/readback.txt`. The original height-only publication rehearsal also passed.
- Read-only hosted preflight matched all 120 canonical IDs/source bindings, confirmed the publishing operator is an active administrator, and found the original 40 picks intact. The guarded publication then updated approved metrics and applied the confirmed withdrawal without deleting historical picks or ownership.
- `pnpm test:roster-rest:local` passed 465 pgTAP assertions, migration upgrade and concurrent enrollment checks, and a disposable real PostgREST test. The previous roster query reproduces `PGRST201`; the shared explicit query returns the roster/program and supplied ADP successfully at AAL1.
- The screenshot follow-up browser suite passed both themes, filtered/final-row separator checks, history separators, forecast spacing, supplied metrics and game-event aggregation. It generated 64 screenshots with zero browser errors and zero player-page axe violations. APIs are controlled fixtures.
- The rules/roster follow-up expanded the browser suite to 78 screenshots, every rules topic, public rules access, contextual navigation, full-roster compatible swaps and locked-starter rejection, original versus adjusted ADP and all three sorts. The rules and player-page axe checks returned zero violations. Hosted signed-in interaction remains unverified.

## Hosted release

1. Completed: encrypted local/offsite backup, verified file recovery and isolated offsite database restore before publication. Applied `20261014151316_player_display_metrics.sql` and `20261014210528_league_settings_and_live_adp.sql` to the intended beta project without roles, seeds or Vault changes.
2. Run `pnpm import:player-metrics` with the actual publishing administrator UUID in `BROCK_PUBLISH_OPERATOR_PROFILE_ID`. The command generates `dev/tmp/roster-metrics-publication/plan.json` and `publication.sql`; it does not apply SQL. It uses the original protected roster plan through `BROCK_PUBLISHED_ROSTER_PLAN`, or the October 8 publication receipt by default, and the retained October 14 suppression record.
3. Completed: applied the reviewed atomic transaction with the explicit linked project. Readback matches the expected 119 visible active eligible athletes, 119 supplied ADPs and 59 heights; all 40 picks remain. Protected source evidence, SQL and withdrawal details remain ignored.
4. Completed: deployed committed source `594ba51` to the preview environment and assigned only `beta.brockfantasy.ca`. The [follow-up release receipt](release-evidence/beta-repairs-2026-10-14.json) records HTTP checks, bundled query readback, ADP audits and recovery evidence. Hosted signed-in manager/commissioner acceptance, including a completed draft URL, separate results, and ADP after another league completes a draft, remains distinct from mocked-browser and SQL-role evidence. No browser surface was available in this session.

The release targets only the beta alias; the production alias and paused scoring are unchanged. Full hosted Auth/app acceptance and real-device interaction remain separate checks.
