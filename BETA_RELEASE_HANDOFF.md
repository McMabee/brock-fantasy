# Beta release handoff

October 15, 2026. Ty requested source completion and pushes to `beta` and will handle deployment and merging into `main`.

## Delivered source

- Ten-athlete roster: seven starters including any-position FLEX, plus three reserves in a separate bench list, with athlete headshots and initials fallback
- Explicitly saved, atomic starter/bench swaps, desktop drag and mobile selection, per-game locks and preserved earned points
- Insights and complete schedules across roster, lineup, free agency and opponent teams; next-fantasy-period projection filters and sorting
- Standings team links open `/league/[id]/teams/[teamId]` with team name, total fantasy points, W–L–T and the complete read-only roster
- Draft-room panel appears only while the draft is scheduled, active or paused; completed results remain in Settings with an overview notice
- Administrator scorekeeping spacing and readable Rules headings/top padding
- Official schedule sync, prominent pending confirmation, MFA administrator review and audited overrides
- Public participant access after email verification, eligibility and terms; administrator MFA remains required
- Association redesign in the companion repository uses the same original logo, colours and fonts, with Play Fantasy pointing to `play.brockfantasy.ca`

## Deployment sequence

1. Record a current backup receipt and restore verification before the database upgrade
2. Apply the unapplied `supabase/migrations/20261015025016_flex_game_lineups_and_schedule_review.sql` to the approved beta Supabase project `fdovowiihxowzatewxgv`, then verify existing leagues, points and the seven/three roster upgrade
3. Build/deploy the fantasy app beta branch with `EXPO_PUBLIC_APP_ENV=staging` and `EXPO_PUBLIC_APP_ORIGIN=https://beta.brockfantasy.ca`; permit public participant traffic in Vercel project settings
4. For the later production merge, use `EXPO_PUBLIC_APP_ENV=production` and `EXPO_PUBLIC_APP_ORIGIN=https://play.brockfantasy.ca`, and bind that domain to the fantasy app project
5. Keep association domains on the association project, using `https://www.brockfantasy.ca` as the canonical signup-receipt origin and redirecting the bare domain there; set `ASSOCIATION_ORIGIN` to that canonical association origin, `BETA_SIGNUP_ORIGIN` to the chosen fantasy origin, and the fantasy server's `PUBLIC_REGISTRATION_ORIGIN` to the same www association origin
6. Review the Supabase Auth config diff before changing it; allow exact verification/recovery callback URLs for beta and play, verify readback and real email delivery; preserve the requesting browser's recovery session
7. Configure only private GitHub environment secrets `BROCK_SCHEDULE_SUPABASE_URL` and `BROCK_SCHEDULE_SERVICE_ROLE_KEY`, run the beta workflow manually and verify all six source receipts and pending confirmations; scheduled workflows run from the default branch after Ty's merge
8. Rehearse verified participant signup, eligibility, join/create, draft, saved swaps and opponent rosters, plus MFA scorekeeping and schedule overrides on the deployed site

The schedule worker is pinned to the approved beta project. The migration schedules projection health checks but does not enable paused scoring. No hosted migration, deployment, credential update, email send or domain change was performed during this source handoff.

## Verification scope and remaining external gates

The current `pnpm check` passed formatting, lint, SQL parsing, TypeScript, 40 domain tests, 70 script tests, API authorization/host checks, web export, browser secret checks, auth/admin regression checks and Android/iOS exports. The unchanged gameplay migration passed 531 isolated pgTAP assertions, complete four-/ten-manager drafts, existing-league upgrade and historical-scoring/trade rehearsals in the earlier local implementation pass. Browser fixtures exercise both themes and 320–1440 px layouts; they do not establish real hosted email, signed-in acceptance or physical-device behavior.

The final `pnpm test:ui` passed with 96 screenshots, no browser exceptions and no detected accessibility violations in the checked views, including both administrator scorekeeping themes. It exercises standings-to-team navigation, points/record, complete opponent roster, separate starter/bench lists, full-bench dragging/swaps, explicit save, Rules typography and pending schedule review. Lint, TypeScript and web export were repeated successfully after the final browser accessibility attributes were added. Association checks and desktop/mobile signup journeys passed, as did its five-width landing accessibility/overflow review.

Existing dependency audit findings remain: two high advisories in Expo build tooling (`node-forge`, `braces`) without published fixed versions, and two moderate transitive advisories (`uuid`, `decode-uri-component`). The decoder's fixed release changes its module contract to ESM while the installed consumer uses CommonJS, so an untested override was not applied. `uuid`'s affected buffered v3/v5/v6 methods are outside the inspected xcode v4 use. Do not describe the dependency audit as clean; reassess compatible upstream Expo releases before production. Association production dependency audit reported zero advisories.

Public policy approval, provider/SMTP operation, backup/restore evidence, signed-in hosted acceptance and scorekeeper rehearsal remain owner release evidence. Historical repository notes may refer to the previous private beta; current public-facing copy and this handoff reflect the approved participant model.

The existing signup form requires the age/eligibility attestation and presents links to the draft terms/privacy notices. It does not prove separately persisted, versioned terms acceptance; review and approval of those policies remain an owner prerequisite before production. This pass preserves those existing account checks.

## Security review

Codex Security sealed the association's five-file source review (`04e13bef-5419-4e5f-856a-8479a87e0d95`) and the fantasy app's forty-file source review (`1fe20acb-b7af-4420-848e-57d41ac4b3c4`) with no reportable new findings. Models and coverage retain hosted-state and policy prerequisites. The final explicit browser `aria-checked`/`aria-selected` attributes and documentation updates followed the sealed snapshots and receive separate source/browser verification; they change no authorization or scoring behavior.

Tool-reported cumulative thread accounting includes implementation history and cached input; it is not an isolated audit cost:

| Scan        | Total tokens | Input tokens | Cached input tokens |
| ----------- | -----------: | -----------: | ------------------: |
| Association |    9,261,232 |    9,224,039 |           8,971,520 |
| Fantasy app |   12,681,891 |   12,647,533 |          12,410,240 |
