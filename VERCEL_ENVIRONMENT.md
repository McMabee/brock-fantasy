# Vercel environment setup

The beta uses the existing Expo **server** export and root `api/index.js` Vercel
adapter. Keep the repository root, `pnpm install --frozen-lockfile`,
`pnpm build:web`, output `apps/client/dist/client`, included bundle
`apps/client/dist/server/**`, and Node 24.x. Do not switch to SPA output.

## Beta variables

Open Vercel → project **brock-fantasy** → **Environment Variables** (under
Settings in some dashboard layouts). Add these seven project variables with
target **Preview**, Git branch **beta**. Branch overrides take precedence over
general Preview settings. Enter values without surrounding quotes.

| Name                                   | Beta value                                                        | Type / visibility |
| -------------------------------------- | ----------------------------------------------------------------- | ----------------- |
| `EXPO_PUBLIC_APP_ENV`                  | `staging`                                                         | Config / `config` |
| `EXPO_PUBLIC_SUPABASE_URL`             | `https://fdovowiihxowzatewxgv.supabase.co`                        | Config / `config` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `<publishable key from this Supabase project>`                    | Config / `config` |
| `EXPO_PUBLIC_APP_ORIGIN`               | `https://beta.brockfantasy.ca`                                    | Config / `config` |
| `EXPO_PUBLIC_SUPPORT_EMAIL`            | `tymabee@proton.me,gt22me@brocku.ca`                              | Config / `config` |
| `SUPABASE_SECRET_KEY`                  | `<server secret key from this Supabase project>`                  | Secret / `secret` |
| `AUTH_RATE_LIMIT_HMAC_SECRET`          | `<private random secret generated from at least 32 random bytes>` | Secret / `secret` |

All `EXPO_PUBLIC_*` values are browser-visible configuration. Expo needs them
during the build, and API routes also read public configuration at runtime.
Vercel forbids Secret visibility for public framework prefixes. If an old public
variable is saved as Secret, recreate it as Config; do not rename private
credentials to use a public prefix. Vercel API payloads use `visibility=config`
with `type=encrypted` (or `plain`), and `visibility=secret` with `type=sensitive`.
See [Vercel Config/Secret documentation](https://vercel.com/docs/environment-variables/sensitive-environment-variables).

`pnpm build:web` checks the five public Config variables before Metro on Vercel.
It requires staging plus the beta origin when `VERCEL_GIT_COMMIT_REF=beta`, and
never requires the two private secrets during export. The application also
validates public configuration during rendering.

Copy keys privately from [Supabase project Settings → API Keys](https://supabase.com/dashboard/project/fdovowiihxowzatewxgv/settings/api-keys).
Use a `sb_publishable_...` key for the public variable and a `sb_secret_...` key
for the server variable. A legacy `anon` JWT is supported for public compatibility;
only a legacy `service_role` JWT is supported as the server fallback. Secret API
keys travel in `apikey`, never as Bearer JWTs. Do not commit real keys or paste
server credentials into chat. [Supabase documents the boundary and header requirements](https://supabase.com/docs/guides/api/api-keys).

Enable **Enable access to System Environment Variables** in Vercel's Environment
Variables page. The limiter requires Vercel's system `VERCEL=1`; do not manually
forge it for another host. [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables)
are available at build/runtime. Do not disable Expo public variable inlining.

After saving variables, create a **new beta deployment**. Public values are
compiled into browser assets, so editing variables does not fix an existing
deployment. For the first retry, redeploy without the previous build cache.
Assign `beta.brockfantasy.ca` to branch `beta` under project Domains and verify
the deployment's target is Preview. A custom domain does not select environment
variables by itself. [Branch-specific Preview settings](https://vercel.com/docs/environment-variables/manage-across-environments)
apply to deployments from that branch.

## Preview versus Production

- For the requested setup, all seven entries belong to **Preview → beta**.
  Do not select Production for the staging origin/environment in a project that
  also serves the live site.
- If this Vercel project actually sets **Production Branch = beta**, beta
  deployments use Vercel's **Production** target instead. In that dedicated
  beta project put the same staging values in Production, and add Preview/beta
  entries if you also create Preview deployments. Inspect the deployment target;
  `EXPO_PUBLIC_APP_ENV` describes the app, not Vercel's target.
- For the eventual live deployment, create separate **Production** entries with
  `EXPO_PUBLIC_APP_ENV=production` and
  `EXPO_PUBLIC_APP_ORIGIN=https://brockfantasy.ca`. The public project URL/key and
  support recipients stay the same. Configure server secrets separately there.
  The current cross-host policy uses the same HMAC value to share rate buckets.
  If Vercel's optional Require Separate Production Secret Values policy is
  enabled, it conflicts with that cross-host policy; resolve the store/project
  policy before claiming the hosts share buckets. Different Supabase secret keys
  for each environment can still call the same RPC.
- Other Preview branches need their own deliberate configuration. With the
  beta origin setting, sign-in works at the canonical beta domain. A generated
  `*.vercel.app` URL sends a different Origin and receives **403**, before the
  limiter. Keep that origin check; do not allow arbitrary preview origins.
  Signup/recovery need exact allowed Supabase redirect URLs
  `https://beta.brockfantasy.ca/api/auth/callback` and
  `https://beta.brockfantasy.ca/reset-password` as well.

## Debugging authentication

Vercel function logs contain only fixed diagnostic codes and optional HTTP
statuses, never passwords, IPs, keys, tokens, or provider response bodies.

| Event / reason                                                                                    | Action                                                                                                                          |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `brock_auth_rate_limit_unavailable` / `vercel_runtime_missing`                                    | Enable Vercel system variables and redeploy.                                                                                    |
| `app_environment_invalid` / `supabase_project_mismatch`                                           | Correct runtime staging/project configuration in the deployment's target.                                                       |
| `hmac_secret_missing_or_short` / `server_credential_missing` / `server_credential_invalid`        | Set the two private Secret entries in the same target/branch; check key type and HMAC length.                                   |
| `trusted_ip_missing_or_invalid`                                                                   | Verify Vercel forwards a single valid client IP; examine ingress/proxy configuration without logging the address.               |
| `rpc_http_error`                                                                                  | Check HTTP status: key/project/permissions, applied migration, exposed `public` schema, schema cache, or Supabase availability. |
| `rpc_network_or_timeout` / `rpc_invalid_response`                                                 | Check Supabase/network health, three-second timeout, and boolean RPC response.                                                  |
| `brock_auth_provider_unavailable` / `public_supabase_url_missing` / `public_supabase_key_missing` | Correct public configuration in the function runtime.                                                                           |
| `provider_http_error` / `provider_network_or_timeout` / `provider_invalid_response`               | Check Supabase Auth health, five-second timeout, or malformed provider output.                                                  |

Rate denial (`false`) returns **429**. Configuration/store/provider unavailability
returns generic **503** with `Retry-After: 30`. An invalid password/provider
rejection returns **401**, and an origin/CSRF failure returns **403**. A successful
sign-in calls the counter, then Supabase's password grant with the publishable
key, then `/auth/v1/user`, and sets HttpOnly session cookies.

## Rate-limit RPC and verification

Migration `supabase/migrations/20261001230524_web_beta_foundation.sql` defines
`public.consume_rate_limit(p_key text, p_limit integer, p_seconds integer)` returning
`boolean`. EXECUTE is revoked from PUBLIC, `anon`, and `authenticated`, and granted
only to `service_role`. New server secret keys act as that role. The function has
an empty search path and updates a private counter with atomic
`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, keyed by hash/window. It is a
fixed-window limiter; adjacent-minute bursts and shared campus/NAT buckets remain
expected. Cleanup runs on calls, removing windows older than two days. No database
migration change is needed for this configuration fix.

Repository migrations do not prove that the hosted project has applied them.
In Supabase SQL Editor, use this read-only check:

```sql
select p.proargnames, pg_get_function_result(p.oid),
       has_function_privilege('service_role', p.oid, 'EXECUTE') as server_can_call,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_call,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as user_can_call
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'consume_rate_limit';
```

Expected: argument names `{p_key,p_limit,p_seconds}`, result `boolean`, server
`true`, anon/user `false`. No row means the migration/RPC is absent. Check
overloads/signature and schema-cache errors if the RPC still cannot be found.

`pnpm verify:auth-config --public-only` validates public settings and reads Auth
settings without server secrets. The default command also requires hosted
server configuration. It reads process variables on Vercel, or root `.env`
locally; `BROCK_AUTH_ENV_FILE` selects a private env file. Process variables win.
Neither mode prints credentials. With private credentials securely available,
`pnpm verify:auth-config --check-rate-limit` additionally calls an isolated random
bucket twice, expecting `true` then `false`. It makes no account/login requests;
the probe row is removed by normal RPC cleanup.

Run `pnpm verify:web-env-boundary` after the web export to check that server
environment references are absent from browser output and supplied server
credential values are absent from both exports. `pnpm check` and CI include this
gate. `pnpm test:web-auth:local` uses the actual exported API and Vercel adapter
with mocked provider responses to verify successful sign-in, 401/429/503 outcomes,
cookies, origin protection, and safe diagnostics. Local checks do not establish
that the hosted environment or login has been repaired.
