# Vercel web-beta hosting preparation

Selected host: Vercel. Intended production origin: `https://brockfantasy.ca`. Operator, support and security owner: Ty Mabee. This configuration is prepared locally; no Vercel project, DNS change or deployment has been performed.

The [local adapter smoke](evidence/2026-10-06-vercel-adapter-smoke.json) ran the transpiled `api/index.ts` through a Node HTTP server: root HTML 200, CSRF 200 with a security cookie, anonymous session 200, protected data 401, and wrong-origin sign-in 403. Auth responses retained `no-store`. This verifies the local adapter/export path, not Vercel's hosted routing, deployment packaging or runtime.

Use `apps/client` as the Vercel project's Root Directory, with access to workspace files outside that directory so pnpm can resolve `packages/domain`. The checked-in `apps/client/vercel.json` builds the Expo server export, serves `dist/client`, includes `dist/server/**` in the Node function, and forwards dynamic requests through `api/index.ts`. The adapter is pinned directly as `expo-server@57.0.3`. Keep `web.output: "server"`: authentication and application APIs depend on server routes. This follows the current [Expo Vercel adapter documentation](https://docs.expo.dev/router/web/api-routes/#vercel).

Create isolated staging and production projects/environments. Choose the staging hostname and processing region before setting origins or Auth redirects. Select a compatible supported Node runtime in Vercel project settings (the workspace requires Node ≥22.12), and verify the Vercel build includes the server export and preserves authentication cookies.

Configure these values separately for each environment in its deployment environment store:

- `EXPO_PUBLIC_APP_ENV`: `staging` or `production`.
- `EXPO_PUBLIC_APP_ORIGIN`: exact HTTPS origin; production is `https://brockfantasy.ca`.
- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: environment-specific public configuration.
- `EXPO_PUBLIC_SUPPORT_EMAIL`: the confirmed monitored support mailbox.

Keep sports-provider/service-role keys out of public variables, source files and exports. Ordinary web Auth uses the publishable key and same-origin server routes; privileged database/Edge operations require separately controlled server secrets.

For production, Supabase needs exact allowed redirects `https://brockfantasy.ca/api/auth/callback` and `https://brockfantasy.ca/reset-password`. Add the equivalent fixed staging URLs to the staging project, configure SMTP, then rehearse verification and recovery on both hosts. Do not assume preview hostnames satisfy configured-origin checks or redirect allow-lists.

Before launch, replace the process-local Auth throttle with an approved shared store, verify hosted cookie/cache isolation, select function/database regions, configure monitoring and backups, and complete the release rehearsal. `pnpm check` verifies the local export, types and tests; it does not test Vercel's build service or hosted runtime. Project access, staging hostname, regions, SMTP, DNS and release authorization remain outstanding.
