# Admin league explorer

The Operations centre links to `/admin/leagues` through **Leagues registered**. The metric counts setup, drafting, and active leagues in the current season, including registrations awaiting members or a draft

The explorer chooses the latest published season whose first regular period has started, using database time. A pool with approved rankings establishes publication even after the pool is deactivated. Future publication does not move this tracker forward, and the previous started season remains selected during the off-season. The league-creation selector is unchanged

The directory defaults to Current and Open. Season and status filters support multiple selections; no selections in a group means all. Previous includes older leagues of every status when no status is selected. Individual season labels and clearing the season group also expose legacy competition leagues, including unmatched season labels. Search accepts literal league names or exact IDs, team names, member display names, and member email addresses

Every explorer RPC checks application access, the admin role, and AAL2. Public functions are invoker wrappers around private implementations. The roster and chat screens have no participation or moderation actions, even when the administrator is the commissioner or owns a team. Hidden messages are included and labelled, personal mutes are ignored, and existing retention remains in effect

## Verification

- `pnpm test:admin-leagues:local` replays all migrations into an isolated disposable database and runs the RPC boundary and explorer pgTAP suites
- The database suite checks season selection, counts, filters, literal searches, roster scoping, hidden chat, cursor ties, read-only behavior, and query plans on 5,000 synthetic leagues
- `pnpm build:web` exports both new routes and the authenticated data proxy
- `pnpm test:admin-leagues:browser` tests the exported screens on desktop/dark and phone/light with synthetic admin data, including access loss, stale roster responses, chat refresh gaps, focus-aware polling, and accessibility
- Browser screenshots are written to `test-results/admin-leagues`
- Navigation tests run with `node --experimental-strip-types --test scripts/lib/admin-league-navigation.test.mjs`

## Release

- Apply `20261027201946_admin_league_explorer.sql` before deploying the client
- Verify the tracker against the current-season open directory in a real MFA-admin session
- Check a league where the admin has no membership and one where the admin owns a team
- Confirm member email visibility, hidden-message labels, all sections, and safe sign-in/MFA return navigation
- Verify direct RPC denial using a regular member and an admin session without MFA
- Keep local fixture results separate from hosted acceptance

## Production rollout on October 27, 2026

- Production at `https://play.brockfantasy.ca` already serves commit `1380784`
- Both the participant-scan prerequisite migration and `20261027201946_admin_league_explorer.sql` are applied, bringing hosted migration history to 57 entries
- A fresh encrypted backup was copied off-site and restored export hashes matched before migration
- Hosted security advisors report no errors
- Database-role rehearsals verify the current-season count, every league section, roster scoping, and the administrator MFA requirement against hosted records
- Anonymous direct RPC calls and the authenticated web proxy deny access, and all new page routes return successful responses
- The user subsequently confirmed that the signed-in production admin views load
- The release agent has not independently observed the complete signed-in browser/MFA journey

## Admin centre refinement

The October 28 refinement moves matching/global counts beside the updated timestamp, removes the read-only badge, and adds teams, grouped photo rosters, and period matchup tables. See [admin centre improvements](admin-centre-improvements.md) for contracts, local checks, and release gates
