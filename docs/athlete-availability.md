# Athlete availability

Administrators manage athlete-wide Active/Injured availability in Operations Centre → Athlete status (`/admin/athletes`). This advisory field is separate from athlete publication, withdrawal, draft eligibility, roster slots, and scoring. Existing and newly imported athletes start Active, without baseline notifications. Subsequent roster metadata imports preserve availability.

An administrator with a verified AAL2 session selects a current approved athlete, chooses a new status, supplies a private 8–500 character audit reason, and saves. The trusted command locks the athlete, checks its availability revision, and atomically saves the status, audit event, and notifications. An unchanged save does nothing. Retry the same uncertain command with its original idempotency key. A stale revision requires a fresh review.

Each injury and recovery transition creates one durable in-app alert per current owner/ongoing league, covering starters and bench athletes. Setup, drafting, and active leagues qualify; completed/archived leagues and released ownership do not. Injury copy identifies the position and asks the manager to find a replacement. Alerts link to the appropriate league lineup and never include the audit reason or administrator identity. New status notification kinds are excluded from push dispatch and the existing service-email allowlist.

Green Active and red Injured pills display current availability, including alongside historical ranking and draft results. Published ranks, picks, queues, lineups, and earned points are preserved. Search filters and status grouping change only browsing order. Paired preseason ranking tables filter status without reordering or renumbering ranks.

A session-scoped shared reader batches athlete IDs in groups of 100, polls visible/focused consumers every 10 seconds, and refreshes on return. Errors preserve explicitly labelled last-confirmed values; missing records never default to Active. Account changes replace the read scope and access denial clears cached statuses.

## Local verification

- `pnpm test:athlete-availability:local` rehearses migrations and affected pgTAP security/gameplay contracts in disposable local databases
- `pnpm test:athlete-availability:browser` exercises synthetic browser journeys against a fixture-configured web build
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:sql`, `pnpm format:check`, and `pnpm build:web` provide the remaining application checks

## Hosted initialization

On 2026-11-25, migration `20261119213017_athlete_availability.sql` was applied to the approved live project used by the `injury-status` Preview. All 120 existing athletes were verified Active, with zero missing or non-Active availability values and no baseline notifications. The database enforces a non-null Active default for future athletes. Existing athlete fields, roster counts, scoring event counts and earned points were preserved. The targeted local suite passed 468 pgTAP assertions plus upgrade and concurrency checks, and hosted security advisors found no error-level issues. Signed-in administrator and MFA workflows remain unverified.

The migration and app changes must be released together before admins use the tool. For a UI rollback, remove access to the editor while preserving the additive fields, audit records, and inbox events.
