# Brock Fantasy Web Beta Operations

Use this runbook with [release readiness](release-readiness.md). For every release, ingestion, correction, incident, or restore, record the immutable commit, environment, rule version, source hashes/import revisions, operator, timestamps, result, and rollback reference. Do not record credentials, tokens, recovery codes, or unapproved raw athlete data.

## Environment and authentication

Create separate staging/production Supabase projects and Vercel server-output deployments. Production is intended for `https://brockfantasy.ca`; the staging hostname is still needed. Follow [Vercel preparation](vercel-hosting.md). Set `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPPORT_EMAIL`, and `EXPO_PUBLIC_APP_ORIGIN` per environment. The application has no demo mode; missing configuration or unapproved imports remain unavailable.

Before starting a local server or promoting an environment, run `pnpm verify:auth-config`. It confirms the public Auth endpoint is reachable, signup and email confirmation match the beta policy, and a production/staging origin is HTTPS without exposing credentials. It does not prove SMTP, redirect allow-lists, deployments, RLS, or hosted account journeys.

Set the hosted site URL plus exact callback URLs:

```text
https://staging.example/api/auth/callback
https://staging.example/reset-password
https://brockfantasy.ca/api/auth/callback
https://brockfantasy.ca/reset-password
```

Configure SMTP, verified-email/recovery templates, then test signup, confirmation, recovery, password change, refresh, sign-out, revocation, and deletion. Web sessions use HttpOnly, Secure-in-production, SameSite cookies and server validation. Enable TOTP; admins require both the platform role and AAL2.

## Data activation and correction

Run `pnpm import:beta-data` to create a reviewable preview of supplied sources. Publishing requires server-side service credentials and records versioned `source_imports`/`source_rows`; it does not activate an unresolved pool.

The October 6 importer reads 16 CSVs and uses the retained official research artifact for candidate mappings. Original CSV hashes, versioned normalization hashes and the official evidence hash are distinct. Retain them with human approval and database import IDs. See [official research](official-data-research.md) and [source rights](data-rights-register.md). Preview generation does not constitute Tarik's approval.

Before pool activation, reconcile player identity/team/competition/positions, Toronto timestamps, historical-versus-projection classification, mappings, and ranking review. Preserve manual overrides until an AAL2 admin explicitly changes them. Use the administrator scorekeeper to preview a revision, require a source and reason, and publish through the replay path. Never edit stats or totals directly.

Sports API access is unavailable; the operator selected manual updates for the beta. A named scorekeeper checks the official source, records its URL and observed revision/time, finds the reviewed game/athlete, enters complete sport-specific statistics, previews the point difference, and publishes through the audited AAL2 command. A second operator reviews material corrections. Missing inputs remain unavailable; do not enter zero to force publication. Agree on coverage, update and correction windows with Tarik before release. Tarik and the admin team own data/rules and game-day operation; Ty owns support, release and security.

## Scheduled work

Install each job independently so it can be paused and audited. Prove overlapping invocation is idempotent before production.

| Job                    | Cadence                                   | Behaviour                                                                        |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| Manual schedule/status | Cadence awaiting operator approval        | Named coverage, official source/revision, delayed-data notices.                  |
| Manual corrections     | Seven-day review policy awaiting approval | Audited AAL2 corrections; preserve revision history.                             |
| Draft autopick         | Every minute or faster worker tick        | `select public.process_expired_drafts(25)`.                                      |
| Waivers                | Every minute                              | `select public.process_due_waivers(<league id>)`.                                |
| Trades                 | Every minute                              | `select public.process_due_trades(<league id>, 100)`.                            |
| Scoring replay         | Retryable bounded worker                  | Process pending scoring jobs, reject stale revisions, alert on incomplete stats. |
| Push                   | Short interval after configuration        | Service-side dispatcher; in-app notification remains authoritative.              |

Finalise a period only after all required results resolve. A published playoff advancement can change only through explicit audited adjudication.

Automated sports-provider checks are deferred until authorized access, source schemas and rate limits are supplied. Manual sports entry does not replace draft, waiver, trade or scoring job workers.

## Monitoring and incidents

Alert on auth/CSRF/AAL2 failures, provider freshness/schema/mapping errors, incomplete lines, job retries/failures, scoring pauses, draft deadlines, API latency/errors, database capacity, backups, and audit anomalies. Do not include secrets, tokens, chat bodies, or unnecessary PII in alert payloads.

For a scoring incident, pause the affected pool, preserve raw input, correct mappings/rules through the audited import or admin workflow, replay, reconcile with approved fixtures, record the result, and publish delayed-data messaging if necessary. Never directly modify point totals.

## Promotion and restore

1. Run `pnpm check`, database reset/pgTAP, Edge tests, dependency/secret checks, browser E2E, and load checks from the release commit. Attach `pnpm audit --prod`; do not bypass unresolved high-severity upstream build-chain findings without a documented owner, exposure assessment, and expiry.
2. Deploy staging, configure SMTP/redirects/jobs, load reviewed data, and complete the multi-manager rehearsal.
3. Back up production before migration. Promote exactly the rehearsed server-output build only after release gates have evidence.
4. Roll back application failures to the previous hosted build. For incorrect data/rules, prefer an additive forward fix plus audited replay; do not reverse production migrations without a restore plan.
5. Restore the latest backup into an isolated project, execute integrity and critical-journey tests, record achieved RPO/RTO and reviewer sign-off.

Native store distribution and the finished weekly prediction model are outside the web-beta release.
