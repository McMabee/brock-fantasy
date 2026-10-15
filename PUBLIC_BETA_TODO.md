# Public beta work register

Updated October 15, 2026, America/Toronto. Both repositories deliver to `beta`; Ty handles deployment and the later merge into `main`.

## Fantasy app

- [x] FLEX, seven starters/three bench, saved atomic substitutions and per-game scoring history
- [x] Player insights, next-period projections, schedules and administrator confirmation/override workflow
- [x] Separate starter and bench lists with athlete photos in roster and lineup views
- [x] Standings team links open a dedicated team page with name, fantasy points, record and complete read-only roster
- [x] Show draft-room controls only before completion; explain that draft results are in Settings
- [x] Fix admin date-filter spacing, Add player button padding and bottom action spacing
- [x] Verify top padding in every Rules section and make numbered subtitles larger than body copy
- [x] Allow only the beta host in staging and the play host in production, preserving verified/eligible participant access and administrator MFA
- [x] Remove obsolete public-facing access and projection wording

## Association site

- [x] Redesign the landing page with shared Brock colours, typography and the original logo
- [x] Keep the association at brockfantasy.ca and link Play Fantasy to play.brockfantasy.ca
- [x] Retain a visible public-beta link and accurate seven-starter/three-bench gameplay description
- [x] Replace the contact form's false success with a working email action
- [x] Update old administrator-only/private-access copy and preserve account/consent boundaries
- [x] Verify desktop/mobile navigation, responsive layout, keyboard use, reduced motion and logo consistency

## Delivery

- [x] Run the relevant app, database, browser and security checks
- [x] Commit all reviewed work as McMabee using Conventional Commits and push both beta branches

## Owner deployment handoff

Ty explicitly chose to handle deployment. Hosted database migration, backup/restore verification, Vercel deployment, schedule-worker credentials/activation, production Auth redirects and production-domain cutover are deployment steps, not performed by this implementation pass. Main branches remain untouched. Policy approval, hosted signed-in acceptance and scorekeeper rehearsal must be recorded without presenting local tests as hosted evidence.

See [BETA_RELEASE_HANDOFF.md](BETA_RELEASE_HANDOFF.md) for the concrete deployment sequence and known upstream dependency advisories. Historical release notes describe their own earlier state; this register and the handoff describe the current public-participant implementation.
