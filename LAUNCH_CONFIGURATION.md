# Production authentication configuration

In Vercel, open the `brock-fantasy` project under `ty-mabees-projects`, then **Settings → Environment Variables**. Add the following as **Secret** variables for **Production**.

| Variable name                 | Where the value comes from                                                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_SECRET_KEY`         | Open [the Brock project's API Keys settings](https://supabase.com/dashboard/project/fdovowiihxowzatewxgv/settings/api-keys), then copy a **Secret key** beginning with `sb_secret_`. Create a dedicated server secret key there if none exists.           |
| `AUTH_RATE_LIMIT_HMAC_SECRET` | Reuse the existing private authentication HMAC value if another active environment uses this Supabase project. Otherwise generate a random value with the PowerShell commands below. This value is generated locally, rather than obtained from Supabase. |

```powershell
$authSecretBytes = New-Object byte[] 32
$authSecretGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
$authSecretGenerator.GetBytes($authSecretBytes)
Set-Clipboard ([Convert]::ToBase64String($authSecretBytes))
$authSecretGenerator.Dispose()
```

The commands copy the generated HMAC value to the clipboard without printing it. Paste it directly into Vercel. Preserve it in a private password manager for reuse across active environments sharing this database. Do not regenerate it for every deployment.

Neither name should have an `EXPO_PUBLIC_` prefix. Do not commit their values or paste them into chat. The publishable Supabase key is a different, browser-safe value and cannot replace the server secret.

Save both variables, then redeploy the latest **main** commit to **Production**. Changes to environment variables only apply to new deployments. Keep `play.brockfantasy.ca` assigned to that Production deployment.

If the existing Production public variables are set explicitly, use `EXPO_PUBLIC_APP_ENV=production` and `EXPO_PUBLIC_APP_ORIGIN=https://play.brockfantasy.ca`. The tracked public deployment defaults supply these when absent.

# Association signup confirmation

Deploy the association repository's main branch as well. Its `/api/prelaunch/complete-signup` handler consumes the fantasy app's one-time signup receipt and opens the confirmation page.

In the association project's Production configuration, set `BETA_SIGNUP_ORIGIN=https://play.brockfantasy.ca` if the legacy variable is already present. Its name is retained for configuration compatibility. `ASSOCIATION_ORIGIN` must match the fantasy app's `PUBLIC_REGISTRATION_ORIGIN`, normally `https://www.brockfantasy.ca`.

The association receipt handler also needs its existing restricted `PRELAUNCH_DATABASE_URL` credential and database functions. Keep the restricted database role; do not replace it with a general administrator database connection. These are separate from the fantasy project's two authentication secrets.

# Feedback delivery

The feedback form posts to `https://formsubmit.co/c561de24beb750974ce891e2eb88ed52`, using the recipient identifier supplied by FormSubmit for delivery to `tymabee@proton.me`. The form action and report-page helper text do not expose the raw recipient email. Complete FormSubmit's destination activation email when prompted, then submit an owner-approved test report. Automated browser checks intercept these posts and do not send email.

# Verification

A valid empty JSON request to the sign-in endpoint should reach input validation rather than return the configuration-related HTTP 503. A real verified-account sign-in, new-account email verification and inbox delivery still need hosted verification after deployment.

References: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Vercel environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables), [FormSubmit](https://formsubmit.co/).
