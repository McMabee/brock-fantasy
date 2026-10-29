# Isolated feature previews

Feature previews on `feat/ui-policy-refresh` require their own app origin,
association origin and Supabase project. The build deliberately stops before
Expo export if this configuration is absent or points to the live Brock project.
Setting the isolation flag alone does not make the environment isolated.

## App build settings

In the `brock-fantasy` Vercel project, scope these variables to **Preview** and
the **`feat/ui-policy-refresh` Git branch**. Supply real review origins and the
isolated project's public credentials; the descriptions below are not values.

| Variable                               | Required configuration                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `BROCK_PREVIEW_ISOLATED`               | `true`, after the isolated services are configured                                  |
| `EXPO_PUBLIC_APP_ENV`                  | `staging`                                                                           |
| `EXPO_PUBLIC_APP_ORIGIN`               | Stable HTTPS origin for the app preview, without a trailing slash                   |
| `PUBLIC_REGISTRATION_ORIGIN`           | Different stable HTTPS origin for the association preview, without a trailing slash |
| `EXPO_PUBLIC_SUPABASE_URL`             | `https://<isolated-project-ref>.supabase.co`, using a separate project reference    |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public key belonging to that isolated project                                       |

The legacy `EXPO_PUBLIC_SUPABASE_ANON_KEY` is accepted instead of a publishable
key. All `EXPO_PUBLIC_*` values are embedded in the browser bundle; use public
keys only. Neither review origin may be a live Brock domain.

The log lists every failed requirement by name without printing configured
values. Node's module-type warning and Node engine-range warning are separate
from this configuration failure. Environment changes require a new deployment.

## Complete hosted setup

A successful export is only the first step. Before hosted acceptance:

- Override inherited Preview server credentials with isolated credentials,
  including `SUPABASE_SECRET_KEY` and `AUTH_RATE_LIMIT_HMAC_SECRET`
- Isolate provider credentials, email delivery and scheduled work from production
- Configure the association project's branch-specific `BROCK_PREVIEW_ISOLATED`,
  `BROCK_PREVIEW_SUPABASE_REF`, `PRELAUNCH_DATABASE_URL`, `ASSOCIATION_ORIGIN`,
  `BETA_SIGNUP_ORIGIN` and `VITE_BROCK_PLAY_ORIGIN` values, with its database
  connection targeting the same isolated Supabase project
- Set `VITE_BROCK_PLAY_ORIGIN` and `BETA_SIGNUP_ORIGIN` to the app review origin,
  and `ASSOCIATION_ORIGIN` to the association review origin
- Apply migrations to the isolated target and configure its Auth callbacks for
  the review origins
- Seed approved sports records and published rankings with synthetic accounts,
  leagues and conversations, without copying live account or registration data
- Test browser, API and database journeys on both review origins

Do not use the local `build:ui-fixture` script as a functional hosted environment.
Its invalid, intercepted API endpoint is only for local browser suites.

## Current environment gate

On 2026-10-29, Vercel team access was restored and both projects were inspected.
Neither had branch-specific variables for `feat/ui-policy-refresh`. Supabase
reported no preview branches and no separate Brock test project. No environment
values, hosted resources or production data were changed during this inspection.

The agreed fallback remains local isolated verification until hosted isolation
is available at no additional cost. Supabase preview branches incur usage charges;
creating a billed branch requires a separate spending decision. Keeping this
build blocked preserves that boundary.

References: [Vercel environment variables](https://vercel.com/docs/environment-variables),
[Supabase branching](https://supabase.com/docs/guides/deployment/branching),
[Supabase branching billing](https://supabase.com/docs/guides/platform/manage-your-usage/branching)
