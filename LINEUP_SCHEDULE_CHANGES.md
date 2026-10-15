# FLEX, substitutions, insights and schedule confirmation

Requirements approved October 14, 2026, America/Toronto. This change implements seven starters and three bench athletes within the ten-athlete cap. FLEX accepts every eligible position, including goalie. Existing leagues keep their athletes, picks and point events; the highest next-period-projected eligible reserve initially enters FLEX, with season projection and name as deterministic tie breakers.

## Gameplay

Each game's starting lineup is captured at its scheduled start. Both starter and bench athletes lock during that game and unlock when it is marked finished. Managers can make unlimited eligible substitutions between games. Saved changes affect future games; completed-game points remain. A full bench uses a single compatible swap. Desktop dragging and mobile/keyboard selection share the same Save lineup command, ownership checks, complete-roster validation, optimistic concurrency and retry handling. Unsaved web lineup changes are scoped to account and team and survive profile navigation.

Drops, acquisitions and trade execution respect individual game locks. Dropped athletes retain the existing 24-hour waiver window and priority rules. Trades close the old ownership interval and create the new one so delayed fixtures cannot credit a later owner. Locked athletes outside a trade retain their assignments during roster rebalancing.

## Athlete information

Roster, lineup, free-agent, waiver and opponent-roster entries open an insights panel with bio, team, eligible positions, season points, season projection, next-period projection and next game. The panel links to the full player profile. Season points use canonical player-game statistics instead of summing duplicate observations across fantasy leagues. The full profile joins the regular-season and confirmed-playoff schedule with published stats, showing future games before stat lines exist. Other teams' saved starters and bench are visible to league members, read-only. Existing athlete-withdrawal suppression remains enforced.

Free agency includes name search, program and eligible-position/FLEX filters, and next-period projection, season projection, ADP and name sorts. Next-period projection sorts highest first by default; unavailable values sort last. Filter values remain in route parameters when opening a profile.

The forecast is supplied season projected points divided by supplied projected games, multiplied by scheduled games in the next existing fantasy period. The first upcoming period is used before the season. Known zero-game periods show zero. Missing, conflicting or invalid inputs and unknown season schedules show Unavailable and generate deduplicated administrator alerts. Dates and the estimate formula are visible. Projections dependent on pending fixtures are marked pending too.

## Automatic schedules and admin review

The hourly GitHub Actions workflow reads only six approved official Brock schedule pages. It excludes exhibitions and unresolved playoff opponents, preserves stable game identities, and refuses ambiguous matches instead of merging fixtures. Missing source fixtures and parse/fetch errors generate administrator alerts. Absence from a source never silently cancels a game.

New and changed fixtures apply immediately with a prominent `⚠ Pending confirmation` badge. `/admin/schedules` provides source health, projection/sync alerts, pending confirmations, and all-fixture search for overrides. Administrators require MFA. Confirmation and overrides require the current revision and an audit reason. Overrides remain pinned through subsequent syncs until explicitly cleared. Future time, status, opponent, location and phase can be corrected; captured game identity and earned points are protected.

Cancelled games are excluded from projections. Postponed games unlock athletes and are excluded until a replacement time is published. An unplayed postponed fixture discards its obsolete capture and takes a fresh lineup at the replacement start. Rescheduled games belong to the period containing the new start. Started-game conflicts are retained for review without rewriting earned points. The public Rules page explains these behaviors.

## Verification and activation

Local validation passed:

- `pnpm check`: formatting, ESLint, SQL syntax, TypeScript, 40 domain tests, 70 import/script tests, actual web API boundary checks, web export, browser secret boundary, authentication/admin regressions, Android and iOS exports
- Isolated migration suite: 531 pgTAP assertions, including participant and administrator authority, game-start scoring, postponed-game replacement locks, published-stat history protection, revision conflicts and league deletion
- Four- and ten-manager SQL rehearsals: complete drafts, full FLEX/bench saves, duplicate/stale command behavior and 80 matching parity cases; the latest slowest late autopick was below one second
- Trade rehearsal: unrelated active games do not block a trade, locked assignments stay fixed, ownership intervals close correctly, and a late-published fixture credits its original owner
- Existing-league upgrade: all 140 picks and owned athletes plus earned points survived; all fourteen teams received seven starters and three bench athletes, with the expected projected reserve promoted into FLEX
- Mocked browser checks: 92 screenshots across light/dark themes and 320–1440 px layouts, zero browser errors and zero detected accessibility violations on the checked player, Rules and insights views

The browser checks cover full-bench swaps, explicit saves, unsaved changes after profile navigation, free-agent filters, opponent rosters and pending schedule review. They use controlled API fixtures. Real signed-in hosted journeys, live source synchronization and physical-device acceptance remain unverified. Evidence logs are under `dev/tmp/flex-*.log`, with browser results in `dev/tmp/ui-refresh/report.json`.

Codex Security completed scan `53d26656-35f9-4742-839b-5e2723cc76ab` over its immutable 29-source-file patch snapshot with no reportable findings. The final insights API allowlist, postponement relock and published-stat history fixes were independently reviewed after that scan was sealed, with no additional candidates found. The sealed report therefore describes its recorded earlier snapshot. No hosted or exploit execution was performed, and Daybreak capability was unavailable. The tool reported 8,512,455 total tokens across four threads, including existing implementation history and 8,098,944 cached input tokens; this is not an isolated review-cost measurement.

The generated security report is `C:/Users/tbone/.codex/state/plugins/codex-security/scans/brock-fantasy/997ad3ea9b61a771f350951d2473261a760244fc_20261015T033736Z_641b3xuo/report.md`.

Hosted activation remains a separate release step:

1. Take and verify the required backup/restore evidence, then apply `20261015025016_flex_game_lineups_and_schedule_review.sql` to the approved beta project
2. Deploy the tested client/server build to the beta alias and verify signed-in manager and administrator journeys
3. Configure private GitHub `beta` environment secrets `BROCK_SCHEDULE_SUPABASE_URL` and `BROCK_SCHEDULE_SERVICE_ROLE_KEY`
4. Publish the workflow on the default branch, run it manually once, verify all six source receipts and pending/override behavior, then allow its hourly schedule

The worker is pinned to the approved beta project. These secrets must never enter browser configuration or source control. The migration also schedules missing-projection health checks every fifteen minutes. Applying the migration does not enable paused scoring. The local checks do not activate hosted infrastructure. Ty subsequently requested commits and pushes to both beta branches, with deployment retained by Ty; see [BETA_RELEASE_HANDOFF.md](BETA_RELEASE_HANDOFF.md) and [PUBLIC_BETA_TODO.md](PUBLIC_BETA_TODO.md) for the current delivery and UI follow-up.
