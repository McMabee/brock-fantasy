# Admin panel access

The beta admin panel uses `/admin` on `https://beta.brockfantasy.ca`. The same
routes work on `https://play.brockfantasy.ca` after production configuration.

October 8, 2026: the beta deployment is live. Ty confirmed that MFA is enabled
and that staff management, provider import, and the scorekeeping workspace are
accessible. Hosted readback confirms one admin and one verified TOTP factor.
Real staff grants and successful import/score publication are separate checks;
The six approved rosters now have 120 published player records, excluding both
recorded opt-outs, with supplied history and projections. Canonical games are
still empty. Draft eligibility and the player pool remain inactive.

The beta hostname has a Vercel Deployment Protection exception; generated
preview URLs retain Vercel Authentication. Admin APIs still enforce the app's
authentication, role, and MFA requirements. This release was deployed from the
local working tree; commit the reviewed changes before a subsequent Git
deployment to preserve this implementation.

## Sign in

1. Open `https://beta.brockfantasy.ca/admin` and sign in with your verified
   Brock Fantasy account. Opening a specific workspace before sign-in returns
   you to that workspace afterward.
2. Set up your own authenticator when prompted. Scan the QR code or enter the
   setup key into your authenticator app, then enter its current six-digit code.
   Keep the setup key private. Subsequent sign-ins use the enrolled authenticator.
3. An admin role and a verified MFA session are both required. MFA enrollment
   alone does not grant admin access. If access is missing, the page identifies
   the signed-in account and directs you to the operator.

Ty Mabee (`tymabee@proton.me`) is the sole super administrator. Staff register,
verify their email and confirm eligibility first. Ty completes MFA, opens
**Admin panel → Administrator invitations**, enters their email and selects
**Send admin invitation**. The emailed link asks them to sign in with that account,
then opens the existing QR-code/six-digit authenticator setup. An existing
authenticator can be verified instead. Successful verification and invitation
acceptance activate their admin access automatically.

Standard admins have the same import, scorekeeping and operations privileges.
Only Ty can invite admins, cancel invitations or revoke staff admin access.
Invitations expire after seven days and are bound to the recipient's account and
verified email. Forwarded, cancelled and expired links cannot grant access.

This invitation change is locally validated and requires the new database
migration, web deployment, and server-only `RESEND_API_KEY` plus
`ADMIN_INVITE_EMAIL_FROM` from a verified sender domain before it is live.
Supabase's existing SMTP setup continues to handle registration and recovery.
See [administrator onboarding](dev/docs/admin-account-management.md) for setup.

## Workspaces

| Path              | Purpose                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `/admin`          | Ingestion health and recent audit events                               |
| `/admin/games`    | Search games, enter scores/stat lines, preview and publish changes     |
| `/admin/import`   | Ingest mapped provider/manual JSON through the audited pipeline        |
| `/admin/accounts` | Ty-only emailed admin invitations, lookup, cancellation and revocation |
| `/mfa`            | Enroll or verify the current account's authenticator                   |

Scorekeeping loads the latest game version before editing. Preview the current
stat lines, enter the official source reference and an audit reason, then
publish. Existing credited player lines are retained and can be corrected in
place. Changes to stat lines invalidate the preview. A concurrent revision is
rejected by the server; reload the game before retrying.

Empty game lists mean canonical game records have not been loaded. The published
[player directory](ROSTER_IMPORT.md) is available independently of draft rankings.
Uploaded source previews do not create playable athletes or fixtures automatically.
Scoring preview/publication also requires an active approved pool; publication
requires a configured beta league. These prerequisites must be prepared through
the data materialization workflow before real scorekeeping can be rehearsed.

## Move to play.brockfantasy.ca

No admin source-code change is needed. Links and requests use relative paths;
the configured origin determines the allowed host for mutations and callbacks.

1. Configure Vercel **Production** with
   `EXPO_PUBLIC_APP_ENV=production` and
   `EXPO_PUBLIC_APP_ORIGIN=https://play.brockfantasy.ca`.
2. Configure the public Supabase URL/key and support recipients, plus the
   server-only Supabase and authentication-throttle secrets in that target.
   See [the environment guide](VERCEL_ENVIRONMENT.md). Keep server credentials
   private and outside all `EXPO_PUBLIC_` variables.
3. Add the exact Supabase Auth redirect URLs
   `https://play.brockfantasy.ca/api/auth/callback` and
   `https://play.brockfantasy.ca/reset-password`. Set the Auth site URL to the
   intended primary app origin when making the production switch.
4. Rebuild with the production configuration and assign the production
   deployment to the existing verified `play.brockfantasy.ca` domain. Keep beta
   assigned to branch `beta` with its separate staging origin.
5. Verify `/admin`, `/api/auth/csrf`, `/api/auth/session`, and anonymous denial
   on `/api/admin/games` and `/api/admin/accounts`. Sign in and complete MFA on
   the new domain; browser cookies are scoped to each host.

Both environments use the same approved hosted database, so admin role grants
and score changes apply to that shared data. The host switch does not duplicate
staff accounts or reset authenticator enrollment.

## Local validation

Run `pnpm check`. `pnpm test:admin:local` tests the exported Vercel/Expo routes
with fixture responses: anonymous and AAL1 denial, staff enrollment without an
admin role, enrollment restart, verified-factor preservation, CSRF/origin
checks, HttpOnly MFA cookies, game detail failures, and the configured play
origin. Fixture tests do not enroll real staff or establish live scorekeeping
readiness. Deployment source excludes local documents, supplied data, `.env`
files, and generated exports through `.vercelignore`.
