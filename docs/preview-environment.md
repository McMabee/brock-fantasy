# Feature preview configuration

The user approved using the live Supabase database for `feat/ui-policy-refresh`
on 2026-10-29, retaining the no-added-cost limit. The app and association keep
separate preview origins. Accounts, leagues, registration records and changes
made through these previews use live data.

## App settings

In the `brock-fantasy` Vercel project, these values are scoped to **Preview** and
the **`feat/ui-policy-refresh` Git branch**:

| Variable                               | Configuration                                                               |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `BROCK_PREVIEW_BACKEND`                | `live`, explicitly opting into the shared backend                           |
| `EXPO_PUBLIC_APP_ENV`                  | `staging`                                                                   |
| `EXPO_PUBLIC_APP_ORIGIN`               | Stable HTTPS app preview origin, without a trailing slash                   |
| `PUBLIC_REGISTRATION_ORIGIN`           | Different stable HTTPS association preview origin, without a trailing slash |
| `EXPO_PUBLIC_SUPABASE_URL`             | The approved live Brock Supabase URL                                        |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | That project's public publishable key                                       |
| `EXPO_PUBLIC_SUPPORT_EMAIL`            | The existing public contact setting                                         |

The deployment resolver supplies `EXPO_PUBLIC_DEPLOYMENT_TARGET=preview` to
browser and server builds. The browser validator accepts the configured HTTPS
review origin, and middleware admits requests only on that origin. Neither
review origin may be a live Brock domain. The live/beta hostname checks remain
in effect outside Preview deployments.

All `EXPO_PUBLIC_*` values are embedded in browser JavaScript; only public keys
belong there. The legacy `EXPO_PUBLIC_SUPABASE_ANON_KEY` remains supported. The
app's existing Preview server credentials continue to support authentication.

Without the explicit live-backend choice, previews still require
`BROCK_PREVIEW_ISOLATED=true` and a separate hosted Supabase project. Missing or
invalid settings are reported by name without printing configured values.

## Association settings

The association project scopes `BROCK_PREVIEW_BACKEND=live`,
`BROCK_PREVIEW_SUPABASE_REF` and the three origin settings below to the feature
branch:

- `ASSOCIATION_ORIGIN` points to the association review origin
- `BETA_SIGNUP_ORIGIN` and `VITE_BROCK_PLAY_ORIGIN` point to the app review origin
- `BROCK_PREVIEW_SUPABASE_REF` identifies the approved live Brock project

The existing restricted registration database connection and CA certificate
are available to Production and Preview. Vercel's write-only connection secret
was preserved in place; its value was not copied into source or local files.
Vercel does not allow a Git branch selector on a variable targeting both
Production and Preview, so those two connection variables use environment
scope. The branch-specific mode and origin checks gate this feature preview.
Preview maintenance remains disabled.

## Verification boundaries

Environment changes require a new deployment. Node's module-type and engine-range
warnings are separate from configuration errors. A successful build establishes
deployment compilation, not authenticated browser or email-callback acceptance.

The published ranking and upcoming-game RPC migration `20261029153800` was
deployed to the live database on 2026-10-29 after the UI refresh reached main.
Read-only verification under an ordinary authenticated database role returned
119 published athletes for 2026-27 and six programs. Anonymous REST execution
remains denied. Hosted builds now check these RPCs before exporting the app;
run `pnpm verify:published-sports:hosted` to reproduce that readiness check.
Authenticated browser and email-callback acceptance remain separate checks.

Synthetic accounts, leagues and mutation suites continue to run locally. The
local `build:ui-fixture` endpoint is intercepted and unsuitable for a functional
hosted preview. Hosted checks against the shared backend should use existing
accounts and approved records rather than seeding test data into live tables.

References: [Vercel environment variables](https://vercel.com/docs/environment-variables),
[Supabase branching](https://supabase.com/docs/guides/deployment/branching),
[Supabase branching billing](https://supabase.com/docs/guides/platform/manage-your-usage/branching)
