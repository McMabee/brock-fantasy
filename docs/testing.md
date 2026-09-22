# Testing Strategy

## Local verification

```bash
pnpm install
pnpm exec playwright install chromium firefox webkit
pnpm check
pnpm exec supabase start
pnpm exec supabase db reset
pnpm exec supabase test db
pnpm test:edge:local
pnpm exec supabase db lint --local --level warning
```

`pnpm check` includes deterministic unit tests, strict typechecking, linting, PostgreSQL syntax
parsing, a static web export, Chromium/Firefox/WebKit user journeys, automated axe WCAG A/AA checks
for representative routes, a mobile Chromium viewport, and Android/iOS Metro bundle smoke tests.
Signed native builds still run through EAS on protected preview and production profiles.

With local Supabase running, the Edge smoke creates a disposable verified administrator, proves AAL1
is rejected and completes a TOTP/AAL2 challenge, retains malformed provider input, pauses one
competition and preserves a held payload, resumes ingestion, scores and corrects the synthetic
hockey fixture into a matchup, rejects a conflicting revision, invokes the empty push dispatcher,
exercises account deletion, and removes its other disposable records. It never prints local access
tokens.

The TypeScript suite validates deterministic scoring/correction deltas, snake order/autopick,
roster invariants, provider identity/mapping, CSV-to-canonical conversion, and both standings
formats. PostgreSQL tests validate schema security properties and trusted command behavior.

## Required fixture matrix

Before activating a competition, replace synthetic rules and fixtures with signed-off examples for:

- every scoring category and roster position;
- an in-progress and final game;
- the same payload twice;
- a corrected payload and its reversal;
- unknown athlete, missing statistic, and malformed payload;
- postponed and cancelled games.

## Release suites

- RLS: guest, member, commissioner, other-league member, support, and administrator allow/deny cases.
- Draft: same-athlete contention, duplicate retry, stale client, reconnect, timer race, duplicate start,
  and autopick.
- Transactions: concurrent free-agent claim, waiver priority, invalid drop, trade asset movement,
  expiry, cancellation, lock conflict, and replay after a trade.
- E2E: verify account, create/join a four-team league, draft, set a lineup, transact, ingest and
  correct a fixture, inspect both standings formats, report/mute chat, and delete the account.
- Accessibility: keyboard-only web, focus order, VoiceOver/TalkBack smoke tests, text resizing,
  contrast, reduced motion, and touch targets. Automated axe checks cover home, authentication,
  dashboard, league, draft, league setup, account, ingestion incident, provider-mapping, and replay
  preview views at desktop and mobile web sizes; they do not replace the manual or physical-device
  checks in this list.
- Load: league join bursts, draft contention, score fan-out, and standings recalculation.

No release may ship with failed scoring, access-control, migration, restore, or critical E2E tests.
