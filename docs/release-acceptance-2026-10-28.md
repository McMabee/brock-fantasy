# Release acceptance tracker

Review started October 28, 2026, America/Toronto, against the live application, database
controls, provider configuration, workflow history, and existing release notes
User confirmations below are distinct from automated checks and database-role
rehearsals. The operator requested activation on October 29 after reporting the
remaining acceptance checks passed and explicitly confirming policy and retention reviews

## Interactive checks

| Check | Feature                                                    | Status                 | Evidence or next step                                                                                                       |
| ----- | ---------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1     | Operations Centre, history links, audit panels, layout     | Passed                 | User confirmed all checks in a real MFA session                                                                             |
| 2     | League filters, counts, inspection tables, back navigation | Passed                 | User confirmed combined/cleared filters, search, rosters, standings, matchups, and preserved directory state                |
| 3     | Preseason ranking review                                   | Passed                 | User confirmed current and historical views and current preview; no publication requested                                   |
| 4     | Schedule review filters and layout                         | Passed after repair    | User confirmed the deployed fix returns correct individual/combined programs and respects date/search/cleared filters       |
| 5     | Shared participant scans                                   | Passed                 | User confirmed on October 29 that the shared scan, role filter, dismissal, and undo check passed                            |
| 6     | Live draft and commissioner recovery                       | Passed                 | User confirmed on October 29 that timer, pause/resume, tab refresh, and account-switch isolation work                       |
| 7     | Keyboard, focus, zoom, and themes                          | Passed after repair    | User confirmed navigation, panel activation/focus/dismissal, 200/400 percent zoom, and both themes on October 29            |
| 8     | Consent and optional preferences                           | Passed                 | User confirmed necessary-only sign-in, theme preference persistence/withdrawal, reload, and footer settings on October 29   |
| 9     | Representative screen-reader journey                       | Passed                 | User confirmed the screen-reader journey passed on October 29; reader and browser were not specified                        |
| 10    | Hosted access control                                      | Passed                 | User confirmed signed-out/member denial, admin MFA enforcement, and return to the requested directory filters on October 29 |
| 11a   | Physical-device mobile browser                             | Passed                 | User confirmed real-device browser acceptance on October 29; device/browser unspecified                                     |
| 11b   | Installed native application                               | Operator-reported pass | Operator stated all remaining checks passed on October 29; native build/device unspecified                                  |

## Release controls and operational follow-up

Live release controls were verified enabled on October 29, 2026

| Feature or gate                         | Live state                            | Evidence or remaining follow-up                                                                                                                                                         |
| --------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service email and contact/draft notices | service_email_enabled=true            | Worker credentials, Vault entries, signed delivery webhook, and pg_net configured; controlled message delivered once and operator confirmed inbox/link                                  |
| Varsity confirmation requests           | participant_confirmation_enabled=true | Operator-authorized activation; local recipient/review/security matrix passed; selected test inbox has no scan match, so no synthetic participant request or classification was created |
| Scheduled automatic drafts              | automatic_drafts_enabled=true         | Operator-authorized activation; automatic-draft SQL contracts passed; no existing automatic commitments at activation                                                                   |
| Required draft-mode selection           | mode_selection_required=true          | Deployed setup supports the enabled control; existing completed live drafts preserved                                                                                                   |
| Fresh command keys                      | fresh_command_keys_required=true      | Current clients emit bf2 intents; recent persisted command used the new format; old receipt recovery and expired/new-legacy denial passed locally                                       |
| General retention                       | retention_enabled=true                | Operator explicitly confirmed inventory/holds review; fresh isolated restore and deletion replay verified; first live bounded batch completed with zero removals                        |
| Policy approval                         | policy_publication_approved=true      | Operator explicitly confirmed policy/source-rights review; static policy assets retain draft labels/placeholders for separate final-copy publication                                    |
| Official schedule GitHub worker         | Setup remains open                    | Latest reviewed runs failed on missing/invalid private configuration; repository and beta-environment worker secrets were absent at that review                                         |
| Automated encrypted backups             | Setup remains open                    | Previously reviewed GitHub runs skipped for absent automation variables/credentials; fresh manual encrypted backup and isolated off-site restore verified                               |
| Incident/recovery alert delivery        | Not accepted                          | Monitoring access, escalation, and actual incident/recovery receipt remain separate operational acceptance                                                                              |
| Twenty-four-hour health observation     | Fresh read-only window started        | Started October 29 at 10:07 a.m. Toronto, expected completion October 30 at 10:07 a.m.; workstation must remain awake/online; first rolling sample includes pre-repair cron failures    |
| Scoring                                 | Existing operator hold retained       | No scoring activation was requested; accounts, completed drafts, picks, and point events remain preserved                                                                               |

Participant scans and their independent retention jobs remain enabled

## Automated and configuration evidence

- Hosted check passed seven RPC resolutions, fourteen anonymous denials, and seven public shells
- The latest local release run passed 412 pgTAP assertions for RPC security, automatic drafts, retention/email, and the admin centre, plus the harness concurrency/upgrade checks
- Seven service/privacy unit tests passed, including focused confirmation routes and canonical account sign-in links
- Fresh pre-activation backup captured 60 migrations; the final checkpoint captured all 61 migrations and was restored off-site in isolation with current deletion-manifest replay, zero deletion references, and verified cleanup
- Migration 20261029135648_enable_service_email_network added the missing networking dependency; production now has 61 migrations
- The worker succeeds with its credential; unsigned worker and webhook calls are denied; the networking schema is excluded from the Data API with PGRST106
- The controlled account email was accepted on its first attempt, recorded as delivered through a signed provider event, and confirmed received with a working sign-in link by the operator
- Three successive scheduled dispatches succeeded after the networking repair, with HTTP 200 responses and no timeouts
- Current activation verification preserved 104 Auth users, three completed drafts, 160 draft picks, and 33 point events; the first live retention batch removed zero rows
- Supabase error-level security advisors passed before and after the networking migration
- Source-rights, policy, retention inventory/holds, and remaining manual checks are operator-reported confirmations; no independent native-device or policy-inventory inspection is claimed

Private observation receipts/logs remain outside Git. Review this tracker as each
user confirmation arrives; release flags were enabled through separately audited operator-authorized SQL

## Check 4 investigation

The operator reported empty results when selecting programs. The live API returns
labels such as `Brock Men's Hockey`; the client incorrectly compared those labels
with keys such as `mens_hockey`. The repair resolves program keys through each
fixture's stable competition ID and the already-returned official-source records
No database or fixture changes are required

All 129 current fixtures are confirmed and none has a pinned override, so Needs
review intentionally returns no fixtures. The empty state now explains how to
include confirmed fixtures. With Needs review off and date/search filters cleared,
the expected counts at this review are

| Program            | Fixtures |
| ------------------ | -------- |
| Men's Hockey       | 24       |
| Women's Hockey     | 23       |
| Men's Basketball   | 21       |
| Women's Basketball | 21       |
| Men's Volleyball   | 20       |
| Women's Volleyball | 20       |

Regression fixtures now use all six production-style Brock labels with stable
competition/source IDs, individual and combined program selections, clearing,
date/search intersection, and a completely confirmed schedule

The repair passed four phone/desktop and dark/light browser runs, 60 accessibility
captures with no serious/critical findings or runtime errors, TypeScript, lint,
web export, secret-boundary checks, and Android/iOS exports. It was promoted as
`dpl_DZYXM4cyW9TcNKD83skzd1vgsyAo`; the canonical schedule asset was checked for
both stable competition mapping and the confirmed-fixture guidance

The baseline observer started October 28 at 9:43 p.m. Toronto time. Its first
sample had zero unsafe legacy conflict guards and zero recent cron failures
This observation does not cover the failing GitHub schedule worker or establish
actual email delivery

## Source runbooks

- [Admin centre improvements](admin-centre-improvements.md)
- [Participant scans](participant-scans.md)
- [Privacy and automatic-draft release runbook](privacy-drafts-release-runbook.md)
- [Legal and publication register](legal-applicability-register.md)
- [Database and draft performance acceptance](supabase-optimization.md)

## October 29 continuation

The operator confirmed Checks 5 and 6 passed and subsequently confirmed Check 7
passed after the keyboard navigation repair. The operator also confirmed Check 8
passed: necessary-only sign-in, optional theme persistence and withdrawal, reload,
and reopening cookie settings work. The operator confirmed the Check 9
screen-reader journey passed; the specific reader and browser were not supplied
The operator confirmed Check 10 passed: signed-out/member denial, admin MFA
enforcement, and return navigation preserve the requested directory selections
The operator confirmed Check 11a and reported the remaining manual checks passed
Native build/device details were not supplied The overnight baseline observer contains healthy samples
but a gap between approximately 9:59 p.m. October 28 and 8:51 a.m. October 29
Toronto time. This does not establish uninterrupted twenty-four-hour coverage
The continuous observation gate remains open

## Check 7 investigation

Enter failed on the schedule screen's Back to Operations Centre control because
the shared navigation button used a link role without an actual href. React
Native Web leaves Enter activation to the browser for links, so no navigation
occurred. Space scrolls a link's page; action buttons support both Enter and Space

Navigation now uses Expo Router links with actual destinations, retaining typed
route parameters, pressed styling, disabled/loading behavior, and full-document
public sign-in navigation. The same repair covers shared header, navigation,
footer, help/rules links, and dashboard metric cards. No database or access-control
changes are required

The new regression failed against the old export and passed after the repair
Automated browser checks cover the schedule back link, dashboard history links,
audit-panel keyboard activation, Enter/Space filter activation, Escape dismissal
and focus return, and keyboard directory return with retained URL filters
Four 390/1280px dark/light runs passed with sixty accessibility captures and no
serious/critical findings or runtime errors. A further two dark runs verified
that keyboard sign-in requests the server document, with thirty clean captures
The privacy suite passed fifty-nine assertions. TypeScript, lint, changed-file
formatting, secret-boundary checks, web export, and Android/iOS exports passed

The operator confirmed the hosted retest passed on October 29: navigation,
panel activation and focus behavior, 200/400 percent zoom, and both themes work
This is user-confirmed browser acceptance

The repair was staged, built, and promoted through Vercel as
`dpl_5AmJj1cz4sVfJLBEF2B1bf3uxhZG`. After promotion, the canonical hosted check
passed seven RPC resolutions, fourteen anonymous denials, and seven public
shells. The live privacy shell contains actual navigation anchors, and dashboard
asset `admin-8a64fb77f248678db05d9ca8168afb3f.js` declares the repaired metric
destinations. These read-only checks do not establish signed-in browser acceptance
The repair was deployed from the working tree before the repository commit

## October 29 activation receipt

The operator requested all features be enabled, selected the controlled test inbox,
confirmed inbox receipt and sign-in navigation, and separately confirmed policy,
source-rights, and retention inventory/holds reviews were complete
All seven controls were verified true at 10:14 a.m. Toronto time

- Vercel deployment dpl_EehXFeM8YP8n89Q1qDniNVH6K6HC serves the configured mail worker and corrected account-email sign-in link
- Supabase migration 20261029135648 installed pg_net after the post-activation check exposed the missing scheduler dependency
- Direct and scheduler-triggered test messages each delivered on their first attempt, with signed delivered events; no cron failures occurred after the networking verification
- The grouped SQL suite passed 412 assertions after the audit-plan test accepted either equivalent cursor index and networking checks verified the private dispatcher boundary
- The final encrypted off-site snapshot aba2d082e14fdbdcfb92d84ff3eb48affd6c1fa6f2f16ce7ccabd6864c1b8679 restored 61 migrations, 104 users, 36 imports, 709 source rows, and operator-role management
- The isolated restore recreates pg_net because managed extensions are excluded from the application schema export; network dependency and current deletion replay passed
- Restored application/Auth/provider journeys and independent password-manager recovery-key retrieval remain outside that isolated integrity result
- The existing scoring hold remains active; 160 picks and 33 point events were preserved
- A fresh read-only observation runs from October 29 at 10:07 a.m. to October 30 at 10:07 a.m. Toronto, contingent on workstation/network availability; its first rolling sample includes pre-repair cron failures

Audited activation scripts are in supabase/operations/2026-10-29-enable-*.sql
Existing working-tree edits were preserved during activation

Automatic approval review rejected the local deployment-credential encryption and
cleanup command with only "blocked by policy" as the reason. It did not run
Temporary credential staging files remain outside Git in
D:/Brock Fantasy/Private/release-activation-20261029; they were not copied into
repository files or public evidence
