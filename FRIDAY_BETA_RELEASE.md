# Friday beta release candidate

October 14 follow-up: [league settings, draft results, player metrics, rules and screenshot fixes](BETA_FIXES.md) are deployed to `beta.brockfantasy.ca`. Hosted migrations and guarded data publication are complete: 119 visible eligible athletes, all 119 supplied ADPs, 59 verified heights and all 40 recorded picks retained. An independent audit found zero source/seed/average mismatches. The confirmed withdrawal is hidden and ineligible. The [follow-up release receipt](release-evidence/beta-repairs-2026-10-14.json) records deployment and checks; the original deployed receipt below describes the October 13 version.

Updated October 13, 2026 (America/Toronto). Target acceptance: Friday, October 16.

The candidate is deployed at https://beta.brockfantasy.ca. Deployment `dpl_B1p5i9i3j1sY8vRrR6qDqB6Zx6ca` contains the application changes. No commit, staging or push was performed. Existing leagues and picks were preserved. [Verification receipt](release-evidence/friday-beta-2026-10-13.json).

## Delivered

- Verified, eligible participants can sign in, recover passwords and play. Ordinary gameplay does not require administrator MFA. Staff operations retain administrator/AAL2 checks, and commissioners retain league ownership checks. An older account without eligibility confirmation can personally record it on the sign-in form. No confirmation was recorded for anyone automatically.
- Access and upstream failures return retryable 503 responses. Draft polling preserves its last loaded state, disables commands while disconnected, uses an atomic authorized snapshot, avoids overlapping requests, and backs off during failures. HttpOnly cookie renewal coordinates refresh attempts and retains newly rotated credentials through access-check outages. Confirmed denials remain enforced.
- Draft matching uses bounded augmenting paths with SQL/TypeScript parity. Worker batches do not overlap. Existing scoring, queue-first weighted fallback, two-minute picks, six starters and four unrestricted bench slots remain intact.
- The draft room includes a minutes/seconds clock, readable team names, actual assigned roster slots, dimmed queued previews, queue removal/reordering, immediate serialized queue saves with retries, program/position/search filters, season FP/GP projections, in-room player details, approved headshots, full pick history, league chat/report/mute and own-turn banners/sound. Queue previews do not create ownership, legality reservations or game reminders.
- Published all 129 confirmed games with Toronto/DST conversion, stable opponent/game identities and exact source-row mappings. Repeated publication is idempotent. All six approved programs are participant-visible. The games feed existing schedules, lineup locks and scorekeeping. Published 119 reviewed Brock headshots; one missing image uses initials. The two source opt-outs have no canonical athlete identities or images.
- Commissioners can set/change/clear a planned Toronto draft time before drafting begins. Starting remains manual. The notification center has unread counts, trade/game/draft filters and clickable read entries. Reminders follow roster ownership including bench players; superseded reminders are marked obsolete instead of remaining active.
- Admins have a primary Update game scores and stats action, date/program filters, individual numerical fields, status selectors and yes/no flags. Source references, correction reasons, preview and audited publication remain. Provider snapshot import is secondary.
- Loading improvements include [Expo route splitting](https://docs.expo.dev/router/web/async-routes/), Brotli-compressed cached content-hash assets, sized/lazy headshots, isolated clock renders, stable unchanged snapshots, and pausing league polling when another screen is focused. Measured dashboard initial JavaScript fell from 2.24 MB to about 2.03 MB locally. This is a bundle-size comparison, not a browser speed or Core Web Vitals result. Encoded route chunk filenames were verified on the deployed site.

## Evidence

`pnpm check` passed, including formatting, lint, SQL syntax, types, domain/import tests, public boundary and authentication regressions, web export, browser/server secret boundaries, and Android/iOS exports. The final route-splitting and middleware changes also passed targeted type/lint/export/auth/boundary checks. There are 429 passing pgTAP assertions, 37 domain tests and 59 script tests.

`pnpm test:public-beta:local` completed four- and ten-manager drafts with ten-player legal rosters, duplicate pick retries, queue add/remove/stale-save handling and 20 late autopicks. The slowest late autopick was approximately 0.59 seconds, below the 15-second interval. SQL/TypeScript matching agreed on 80 scarce/flexible/infeasible cases. Independent worker connections verified batch exclusion. `pnpm test:draft-concurrency:local` verified simultaneous authenticated pick, duplicate pick and queue saves with one pick, one version increment and preserved queue priority. Fixtures were local only and removed or rolled back.

Hosted readback confirmed 29 migrations, 129 games/mappings, six active programs, 120 eligible athletes, 119 headshots, and the original league and 40 picks. An existing AAL1 member could read its 40-pick snapshot and catalog; staff access without MFA remained false. Public HTTP checks passed for sign-in, signup, shells, all referenced JavaScript chunks including encoded route filenames, and the original MP3 hash. Anonymous private APIs return 401. The official 84-pixel thumbnail sample returned WebP at 6,856 bytes.

Fresh encrypted off-site backups and isolated database restores passed before and after migration/publication. The post-change cloud database restore took 26.112 seconds. These are database integrity/recovery results; they do not establish a full website/Auth/scoring recovery drill or independent recovery-key verification.

## Remaining Friday acceptance

The Browser plugin reported no available surfaces and `Browser is not available: iab` after refresh, existing-tab lookup and a new in-app-tab attempt, despite the user's @Browser mention. The signed-in browser session and Core Web Vitals were not tested. This limitation must remain explicit.

Complete the hosted participant registration/verification/sign-in/recovery/create/join/draft journey, another multi-user mock with late autopicks and queue races, desktop/mobile light/dark keyboard/reduced-motion checks, chat/photos/sound acceptance, and a named scorekeeper publication/correction rehearsal. Review the repository's existing [release gates](dev/docs/release-readiness.md), especially policy approval, dependency exception decisions, suppression/restore replay, monitoring and operator recovery responsibilities. Weekly prediction modeling, native publication and main-domain cutover remain deferred.

The October 13 dependency readback still reports two high and two moderate advisories, with no critical advisory. Existing exception decisions remain open; this release does not approve them. New draft snapshot, scheduling, eligibility and five-argument league-creation RPC signatures were verified in the hosted REST schema cache and denied to anonymous callers.

Nick can use https://beta.brockfantasy.ca/auth and proceed to the dashboard/draft with a verified, eligible account. Ordinary drafting no longer requires an authenticator challenge. If eligibility has not been recorded, he must personally check the eligibility confirmation when applicable. Administrator tools continue to require completed MFA.

The original `On_The_Clock.mp3` was preserved. Its public copy matches the original hash. Backup credentials, authentication tokens and MFA secrets are absent from this receipt.
