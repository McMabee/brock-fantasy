# Web session investigation, October 22, 2026

The available evidence shows two separate problems: genuine failed session renewals and
temporary failures of authenticated data reads. It does not identify which symptom the
associate meant by being kicked out, or establish one cause for every reported incident.
No production configuration, application code, accounts or sessions were changed during
this investigation. The reproduction used one disposable local account, which was deleted.

## Scope and evidence

The fixed Supabase investigation window is **October 21 at 16:25:03 through October 22 at
16:25:03 EDT**, equivalent to `2026-10-21T20:25:03Z` through `2026-10-22T20:25:03Z`.
Management API queries selected bounded ClickHouse log aggregates and relevant error
records using the existing CLI identity. Both HTTP status and query results were checked.
Raw evidence remains in the private investigation directory under
`D:\Brock Fantasy\Private\session-investigation-20261022T2025`.

| Source                     | Evidence                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase gateway           | 121,133 recorded events, no recorded 429 or 5xx responses                                                                                                             |
| Supabase Auth              | 41,152 events, four refresh requests failed with `refresh_token_not_found`                                                                                            |
| Auth audit                 | 41 successful token refreshes across 11 accounts, 40 token revocations and one explicit logout                                                                        |
| Vercel request records     | Complete unpaginated error result for the available 12-hour query: 248 records, including 162 data-route 503s and four refresh-route 401s                             |
| Vercel runtime             | Only a 30-minute window is accessible on the current plan; recent warnings include `brock_app_access_failed` with `network_or_timeout`                                |
| Live session configuration | JWT lifetime 3,600 seconds, refresh rotation enabled, reuse interval 10 seconds, single-session enforcement disabled, inactivity and absolute session limits disabled |

The 40 token-revocation audit entries must not be interpreted as 40 forced logouts: refresh
rotation normally revokes the previous refresh token. Four failed requests also do not mean
four affected people. The failed-refresh records do not expose sufficient identity context
to associate them conclusively with the reported users.

The hosting service rejected a 24-hour runtime-log query because of retention and a
24-hour request-log query because older records require a paid entitlement. Its available
12-hour request records were retrieved instead. Filtering runtime logs with `level:warning`
misses actual entries tagged `warn`; an unfiltered query recovered the timeout warnings.

## Session failures

These four Supabase refresh-token failures correlate in time with four application
`/api/auth/refresh` 401 responses:

| October 22, EDT | UTC      | Auth result             |
| --------------- | -------- | ----------------------- |
| 10:09:01        | 14:09:01 | Refresh token not found |
| 11:46:24        | 15:46:24 | Refresh token not found |
| 11:48:17        | 15:48:17 | Refresh token not found |
| 14:41:33        | 18:41:33 | Refresh token not found |

The application treats failed renewal with 401/403 as loss of the authenticated user;
protected screens then redirect to sign-in. This is a concrete path to the reported
experience. These requests predate the optimization release promoted at approximately
15:09 EDT. That timing does not prove that every possible session issue predates the release.

There is one explicit logout at **11:48:15 EDT**. It is followed by three Auth
`session_not_found` errors at 11:48:16 and the failed refresh at 11:48:17. This sequence
supports revocation around that logout, but the records do not prove which browser made
the subsequent requests or explain the other failed renewals.

The normal web sign-out handler calls `/auth/v1/logout` without an explicit scope, and
the native sign-out path calls `supabase.auth.signOut()` without one. Supabase defaults to
global sign-out, which revokes all sessions for that account across devices. The ordinary
account action is labelled simply "Sign out". At inspection, 21 accounts had multiple
session rows, so cross-device behavior is relevant to this application.

The local reproduction exercised the exported application HTTP route and actual local
Supabase Auth with two independent sessions for the same fixture account:

| Operation                    |           Other session check | Other session refresh |
| ---------------------------- | ----------------------------: | --------------------: |
| Current application sign-out |                           401 |                   401 |
| Control using `scope=local`  | Not required for this control |                   200 |

This proves the application's cross-device sign-out behavior. It does not prove that this
was the cause of every associate report. There is no recorded `refresh_token_already_used`
error in the investigated Auth records, so refresh-token reuse detection is not established
as the cause. The live settings also do not enforce an inactivity timeout or one-device limit.

## Availability failures and the Supabase incident

Vercel request records show **162 HTTP 503 responses from `/api/data/supabase`**, between
10:30:02 and 16:15:03 EDT within its available query window. They occur on several browser
families and on deployments both before and after the optimization release.

The runtime warning at **16:30:10 EDT**, a supplemental observation after the fixed
Supabase window, explicitly identifies an eligibility request that failed with
`network_or_timeout`. Earlier recent warnings at 16:10 and 16:15 identify application
access as unavailable without recording which upstream operation failed. The code bounds
both live Auth validation and eligibility reads at five seconds, and converts upstream
failures to retryable 503 responses. The gateway recorded successful reads with origin
times approaching five seconds, and some notification reads took longer.

Supabase's [API Gateway Request Issues incident](https://status.supabase.com/incidents/01M5J8ZQ04EZXAYF10Q75MGC1T)
was in Monitoring during the investigation. Its embedded incident data records a start
at 17:01:52 UTC, or 13:01:52 EDT, and describes demand on its backplane. Some application
503s and three failed refreshes occurred before that published start. The incident is a
plausible contributor to current timeouts, but cannot explain the entire observed history
on timing alone. A request that times out before completing may have no corresponding
gateway error event; zero recorded gateway 5xx responses does not rule out network issues.

The current web code preserves the authenticated user on renewal 503/network failures and
shows a retryable error. A data-read 503 is therefore not, by itself, evidence of a revoked
session. The reports might describe a reconnecting/error screen rather than a sign-in
redirect; no client-side navigation trace was available to distinguish those experiences.

Database error inspection found stale/deleted-draft membership denials and CLI connection
failures, rather than evidence of a database-wide session purge or resource exhaustion.
The known draft-status overload errors from the earlier issue also appear in the window;
they are distinct from authentication failures.

## Recommended work

1. Make the ordinary Sign out action explicitly device-local on web and native, while
   retaining deliberate account-wide revocation for security-sensitive flows
2. Add bounded transient retries and clear reconnecting behavior for safe reads without
   clearing authenticated state on network/5xx/429 failures
3. Distinguish a CSRF rejection from a revoked session during renewal, and classify
   non-authentication provider failures consistently before clearing cookies or user state
4. Add privacy-preserving renewal diagnostics with an allowlist of reason codes, status,
   time and request ID, so future reports can be correlated without logging credentials
5. Validate two-device sign-out, cross-tab renewal, idle/background return beyond one hour,
   offline recovery, delayed provider responses and actual invalid/revoked sessions locally
   before deployment

Step 1 has a small implementation surface but changes account-session behavior, so it
needs the two-session regression test and checks that account-wide security revocation is
retained. Steps 2 and 3 have moderate authorization-regression risk: retryable failures must
preserve the session, while verified revocation, deletion and lost eligibility must still
deny access. Do not weaken RLS, extend JWT lifetime, disable token rotation or change billing
as a workaround. No repair or deployment was performed as part of this investigation.

## References

- [Supabase querying logs](https://supabase.com/docs/guides/observability/advanced-log-filtering)
- [Supabase sign-out scopes](https://supabase.com/docs/guides/auth/signout)
- [Supabase session and refresh-token behavior](https://supabase.com/docs/guides/auth/sessions)
