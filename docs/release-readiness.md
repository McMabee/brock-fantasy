# 2026–27 Web Beta Release Readiness

Status date: October 2, 2026. This checklist distinguishes implemented beta behaviour from required release evidence. A passing local check is not staging or production evidence.

## Implemented beta foundation

- One six-program player pool with permanent athletes, season membership, verified positions, ten-player rosters, six starters/four benches, explicit fantasy periods, historical totals, supplied projections, import provenance, and reviewed rankings.
- Versioned combined hockey/basketball/volleyball rules, complete-stat validation, compensating point corrections, period locks, production ADP, ten-round snake drafts, queue-first weighted CPU picks, waivers, and audited trade review commands.
- Same-origin Expo server routes with HttpOnly cookie web sessions, CSRF/origin checks, authenticated data reads, allowlisted commands, callback handling, account deletion, AAL2/TOTP administration, imports, and score preview/publish.
- Public web registration, email verification, password recovery, password updates, refresh, and logout use Supabase Auth through the server routes. Browser clients retain no bearer credentials or Supabase session state.
- Administrator game search and scorekeeper with revision checks, manual reason/source capture, point-difference preview, and atomic replay.
- Player search and records for current totals, game logs, scoring events, historical/supplied values, ADP, data freshness, next-game locks, season selection, and unavailable weekly forecasts.
- A persistent light/dark web theme uses the exact Brock tokens: navy `#1C2D5D`, red `#F20014`, white `#FFFFFF`, gray `#C8C9CB`, black `#000000`. The authentication selector has an accessible animated selected state with white selected text. No advertisement, sponsor, solicitation, campaign request, demo mode, or runtime sample data is rendered by the client.

## Local implementation evidence

- [x] Disposable local Supabase rehearsal on October 2, 2026: verified registration, confirmation callback, cookie-authenticated session, logout, password sign-in, and restored authenticated session all succeeded. It is not evidence for a hosted Supabase or SMTP configuration.
- [x] Current supplied-data preview: 12 CSV files and 273 source rows are captured with hashes and provenance. It identified one unparseable schedule time and 21 combined-schedule time mappings that require review; it was deliberately not published or activated.

## Activation gates

- [x] Place the supplied licensed logo artwork in app assets and use the approved light/dark variants without regenerating or recolouring them. The web build and Android/iOS export include both assets; visual and assistive-technology review remain staging gates.
- [ ] Run `pnpm import:beta-data`, reconcile all 12 supplied files, resolve ambiguous combined basketball/volleyball game times and all athlete/team mappings, then materialize reviewed teams, athletes, season membership, games, and pool rankings. Do not activate a pool with incomplete required rosters or mappings.
- [ ] Resolve the current importer findings: one `SCHEDULE_TIME` error and 21 `COMBINED_SCHEDULE_TIME` warnings. Keep the affected records unavailable to leagues until an administrator records the official mapping.
- [ ] Obtain official basketball/volleyball rosters and outstanding individual statistics. Preserve source `N/A`, empty, zero, and negative values; never invent detailed historical games or forecasts.
- [ ] Complete the authorized Brock provider adapter: hourly schedule checks, five-minute scheduled-game checks, seven daily correction sweeps, bounded retry/backoff, health alerts, explicit mapping review, scoring pause/resume, manual-override protection, and idempotent replay.
- [x] Record accountable owners: Tarik Merchant owns data/rule approval, privacy/legal, accessibility, support, and game-day operations. Ty Mabee owns release management and security incidents.
- [ ] Assign accountable owners for brand rights and roster/schedule/historical-statistics/provider-data rights. The provided data-rights statement is incomplete and must be finalized before activation.
- [ ] Have Tarik Merchant and the legal operator approve the public-copy drafts in `docs/public/`, resolve all bracketed operator/contact/retention/jurisdiction details, then publish privacy, terms, support, deletion, moderation, delayed-data, and availability notices.
- [ ] Resolve or formally accept the current upstream Expo CLI dependency advisories before deployment: `node-forge` (high, no published patched version), `uuid`, and `decode-uri-component`. They are absent from the exported web bundle and occur in the Expo build/CLI tree, but the audit must be rerun and attached to the release record.

## Hosted setup

- [ ] Create isolated staging/production Supabase and EAS Hosting environments. Configure app environment, Supabase URL/key, support email, and application origin; keep provider/service-role credentials in server secret stores only.
- [ ] Configure the public Supabase publishable key and exact HTTPS callback origin for each environment. Configure Supabase redirect allow-lists before enabling registration or recovery email.
- [ ] Configure SMTP and exact HTTPS verification/recovery redirects for `/api/auth/callback` and `/reset-password`. Prove tokens never occur in browser storage, URLs, logs, bundles, or shared caches.
- [ ] Enable TOTP, assign named platform admins, and prove AAL1 cannot read or execute admin operations.
- [ ] Replace the process-local authentication request throttle with a shared, monitored rate-limit store appropriate for the final multi-instance hosting topology, then verify its failure and recovery behaviour.
- [ ] Deploy migrations, Edge Functions, and server-output web builds; configure DNS/TLS, monitoring, alerts, audit review, backups/RPO/RTO, promotion/rollback, and on-call escalation.

## Required release evidence

- [ ] Run aggregate repository, dependency/secret, database reset/pgTAP, Edge, browser E2E, and load checks against disposable infrastructure, then staging. Record commit, command output, data/rule versions, and reviewer.
- [ ] Complete a multi-manager staging rehearsal: verified signup/invite, drafting/reconnect/autopick, period lineup and bench locks, waiver race, trade acceptance/veto/locked/conflicted states, score correction, standings/playoffs, player history/ADP, chat/moderation, notifications, logout/reopen, and deletion.
- [ ] Reconcile all three sports with data owners, including every coefficient/bonus, goalie attribution, volleyball errors, missing versus zero, duplicates/corrections, historical separation, DST/winter break, lock boundaries, cancellation/postponement, and playoff adjudication.
- [ ] Verify cross-league authorization, forged ownership, revoked sessions, CSRF, recovery, cache isolation, accessibility, responsive layouts, contrast, and absence of advertising. Meet p95 ≤500 ms for normal reads, p95 <1 second draft commits, and five-second committed-update visibility for 100 active managers across ten drafts.
- [ ] Restore a production-like backup into isolation; execute integrity and critical journeys; record backup ID, RPO/RTO, duration, reviewer, and rollback/forward-fix evidence.

## Deferred scope

Tarik’s completed weekly-prediction algorithm remains deferred; only the versioned provider/backtesting foundation is active. Native store distribution is also deferred. Do not call this beta ready with unresolved roster, mapping, statistic, scoring, security, or restore defects.
