# UI and policy refresh acceptance

Implementation branch in both repositories: `feat/ui-policy-refresh`

The existing association work was reviewed and checkpointed separately as `5b58210`.
The five latest fantasy-app commits through `b47603f` were inspected, with regression
coverage for admin navigation, rankings, league exploration, permissions and unavailable
data states. Production branches and hosted application data are outside this delivery.

## Verified locally

- Shared published-ranking renderer and authenticated season/detail reads, including frozen
  history, directory visibility, withdrawn athletes, ties and unequal divisions
- Dashboard fixtures grouped by sport and division, live plus next games, home/away and
  neutral venues, empty/error states, year-free Toronto formatting across the daylight-saving change
- Click-only information icons, keyboard dismissal and focus restoration, forecast dropdown,
  admin-role visibility including pre-MFA accounts, and final-assignment lineup changes
- Phone, tablet and desktop browser scenarios in both themes, including lineup conflict,
  uncertain-save and restored-edit recovery
- Fifty-one domain tests and nineteen focused auth, service-email and UI helper tests
- Fifty-nine cookie, keyboard, spacing, privacy, contact and preference assertions
- Fourteen consistent policy copies on both sites, local links, headings, public contacts,
  assets, and fifty-six phone/desktop light/dark policy layouts without automated accessibility violations
- 1,187 pgTAP assertions on all migrations in temporary databases, isolated concurrency and
  upgrade rehearsals, and no error-level findings from local security advisors
- Expo Android and iOS export compilation
- Association format, server types, build, thirteen unit tests, compiled runtime checks,
  public asset boundary and twenty-four Chromium/Firefox/WebKit phone/desktop browser tests

The SQL test dates for future replacement games had expired on untouched `main` too.
Those fixtures now derive their replacement starts from the test clock. No scoring or
lineup-lock rule was changed. Existing Windows CRLF files caused repository formatting
failures; LF normalization preserved their content, and `.gitattributes` prevents recurrence.

## Remaining evidence and environment gates

The original import/roster verification requires source files absent from this checkout,
starting with `logic/Fall.Winter Brock Fantasy Information - Goalie stats.csv`. The current
source directory contains newer roster and spreadsheet files. Those files were preserved;
they were not renamed, substituted, approved or published to make an older test pass.
The legacy CSV-dependent UI/import suites therefore remain a separate unresolved gate.
The synthetic varsity and admin browser suites do not require those private files.

Use `pnpm build:ui-fixture` before the synthetic app browser suites. It supplies an invalid,
intercepted public test endpoint and clears Metro's cache so local verification does not
depend on cached deployment values or private environment files. Ordinary `build:web`
continues to use the existing local or hosted configuration rules.

Vercel team access was restored on 2026-10-29. Neither project has branch-specific
preview variables, and Supabase has no separate Brock test project or preview branch.
No hosted preview or new Supabase resource was provisioned, and zero additional cost capacity was not established.
Hosted data-dependent acceptance remains pending under the agreed no-added-cost fallback.
See [isolated feature previews](preview-environment.md) for the required configuration.

Preview builds now require explicit app/site review origins and isolated Supabase targets.
They reject live defaults; association maintenance cannot execute in preview deployments.
Any future preview must use approved sports records and synthetic accounts, leagues and
messages, with provider delivery and production schedulers isolated as well.

Browser API fixtures establish presentation and request behavior; the isolated SQL suite
establishes database contracts and authorization. They are separate from a hosted browser →
API → database journey. Native exports establish compilation, not native-device acceptance.
Automated accessibility checks do not replace representative manual screen-reader testing.
