# Release Readiness

Status date: September 22, 2026. This file separates code that exists from evidence or approvals
that must still be supplied. An inactive competition cannot be offered to users.

## Implemented foundation

| Area                 | Repository evidence                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Universal client     | Expo Router application exports for web, Android, and iOS; responsive auth, dashboard, leagues, drafts, lineups, transactions, notifications, admin, privacy, terms, and deletion routes.                                                 |
| Fantasy authority    | PostgreSQL trusted commands for private league join, snake draft, queue/rank autopick, lineup locks, free agents, waivers, trades, schedules, corrections, moderation, and sponsor counts.                                                |
| Scoring              | Immutable pre-validation receipts and raw snapshots, provider mappings, normalized statistics, versioned rules, append-only point events, replay, corrections, and standings projections.                                                 |
| Security and privacy | Verified-email configuration, AAL2/TOTP enforcement for administrators, RLS on user/league/operations data, least-privilege command grants, idempotency records, audit events, minimized profiles, and account deletion/anonymization.    |
| Operations           | Sync/error/audit views, read-only score-replay previews, audited provider-mapping/error review, JSON/CSV ingestion, competition pause/resume with held receipts, Cron-callable workers, push audit, backup/restore and game-day runbooks. |
| Quality baseline     | Strict TypeScript, ESLint, formatting, deterministic domain tests, desktop/mobile Chromium journeys and axe WCAG A/AA audits, SQL parsing, pgTAP schema checks, and universal bundle smoke builds.                                        |

## Canonical remaining-work checklist

This is the source of truth for unfinished work. `docs/operations.md` explains how to carry out the
operational items. `docs/testing.md` and `docs/privacy-data-map.md` provide supporting detail, but
their actionable requirements are repeated here so they do not have to be tracked separately.

### Ownership, rules, rights, and policy

The following owner choices were recorded on September 22, 2026. Entries with multiple people or
groups are recorded as submitted and do not imply a primary/backup order.

| Responsibility         | Assigned owner(s)                                |
| ---------------------- | ------------------------------------------------ |
| Executive Sponsor      | Tarik Merchant & Steve Delaney                   |
| Product/Release        | Ty Mabee                                         |
| Scoring/Data           | Tarik Merchant                                   |
| Data/Provider Contract | Sport Information + Liaison / Gameday Operations |
| Brand/Content-Rights   | Steve Delaney & Brock Athletics                  |
| Legal/Privacy          | Steve Delaney & Brock Athletics                  |
| Support                | Nicholas Zadravec & Tarik Merchant               |
| Game Day Operations    | Ethan Greatorex & Tarik Merchant                 |
| Sponsor                | Ryota Wolff                                      |
| Platform/Operations    | Ty Mabee                                         |
| Security/Incident      | Ty Mabee & Tarik Merchant                        |
| Accessibility          | Nick Kocevar & Elio Palozzi                      |
| Mobile Submission      | Nick Kocevar & Elio Palozzi                      |

- [ ] Complete the ownership record by designating primary and backup contacts, naming the release
      authority, and recording institutional contact, escalation, and approval-evidence details.
- [ ] Approve a versioned rule pack for each of the six teams. It must define scoring examples,
      roster slots, locks, draft timer and autopick order, free agents, waivers, trades, matchup
      periods, finalization/corrections, and tiebreakers.
- [ ] Approve the sports-data provider and contract: credentials, stable athlete/team/game IDs,
      schemas and sample payloads, polling/webhook limits, corrections, postponements/cancellations,
      outage/delayed-data behavior, retention, and data/media usage rights.
- [ ] Approve Brock names, marks, colours, athlete names/media, sponsor creatives/placements, and all
      public content. Replace every placeholder or synthetic asset before activation.
- [ ] Finalize the privacy notice and platform terms shown in the client, acceptable-use/moderation
      policy, retention/deletion schedule, subprocessors, privacy contacts, support email, public
      account-deletion URL, and incident/status communications. Confirm that sponsor metrics remain
      aggregate-only and approve any later analytics separately.
- [ ] Record the October 2 scope decision and the October 8 go/no-go decision, including approvers,
      accepted evidence, deferred features, and the immutable release commit.

### Provider integration and production data

- [ ] Implement the sanctioned `SportsDataProvider` adapter for roster, schedule, game, and game-stat
      synchronization. Add its webhook receiver or scheduled short-running poller, authentication,
      retry/backoff, rate-limit handling, health reporting, and correction semantics without placing
      credentials in the client.
- [x] Add CSV-to-canonical-JSON manual import through the existing ingestion pipeline. The imported
      source rows remain embedded in the canonical snapshot so the raw receipt, validation, mapping,
      replay, and audit controls are shared with JSON/provider input.
- [ ] Replace synthetic rule/fixture data with approved golden fixtures for hockey, basketball, and
      volleyball. Cover every scoring category/roster position, in-progress/final, duplicate,
      corrected/reversed, unknown-athlete, missing/malformed, postponed, and cancelled inputs.
- [ ] Load and reconcile all six official teams records, teams, eligible athletes, schedules,
      games, provider mappings, and complete autopick rankings. Document the basketball activation
      date separately from its October 9 league/draft readiness.
- [ ] Keep each team inactive until its rules, rights, mappings, rankings, golden tests,
      operations owner, and rehearsal evidence are all approved. Never promote the synthetic records
      in `supabase/seed.sql`.
- [ ] Load only approved sponsor campaigns and verify placement windows, click targets, aggregate
      counting, and privacy behavior.

### Hosted environments and delivery automation

- [ ] Create separate staging and production Supabase projects plus an EAS project and protected
      preview/production channels. Replace `REPLACE_WITH_EAS_PROJECT_ID`, verify the iOS bundle ID and
      Android package ID, and configure production versions/signing ownership.
- [ ] Configure environment-specific public Supabase URL/anonymous key, support email, provider
      secrets, webhook secret, service-role access, EAS credentials, Apple/Google credentials, and
      Expo push credentials in their server-side secret stores. Run a secret scan after setup.
- [ ] Configure the production domain, DNS, TLS, EAS web hosting, staging previews, and an explicit
      promotion/rollback path. Add protected CI deployment jobs; current CI verifies builds but does
      not publish them.
- [ ] Configure hosted Auth for verified email, approved redirect/deep-link URLs, recovery, email
      delivery, TOTP enrollment/verification, administrator roles, AAL2 enforcement, review accounts,
      and least-privilege operator access. Test every flow on web and physical iOS/Android devices.
- [ ] Apply migrations and deploy all Edge Functions to staging/production. Configure provider sync,
      draft autopick, matchup advancement, waiver processing, trade expiry, and push dispatch jobs as
      described in `docs/operations.md`; prove jobs are idempotent and independently pausable.
- [ ] Configure logs, dashboards, alerts, on-call routing, provider freshness/error thresholds,
      authentication and ingestion monitoring, status communication, and audit-log review.
- [ ] Select the production database tier; set backup retention, RPO, and RTO; and document a tested
      forward-fix/rollback procedure. Perform and witness an isolated restore before launch.

### Verification and release evidence

- [ ] Run `pnpm check`, dependency audit, secret scan, Expo Doctor, a clean local database reset,
      pgTAP, database lint, and the Edge smoke suite from the release commit. Resolve or formally
      assess every dependency finding.
- [ ] In staging, complete the four-manager E2E journey: verified registration, private league
      create/join, both formats, draft/reconnect/autopick, lineup/locks, free agent or waiver, trade,
      provider import/replay/correction, standings, chat report/mute/moderation, notifications, score
      adjustment audit, and account deletion.
- [ ] Complete the release matrices in `docs/testing.md`: role/league-boundary RLS, draft races and
      retries, concurrent transactions, every provider failure/correction state, and migration tests.
      Automated desktop/mobile Chromium coverage now protects demo navigation, league configuration,
      draft/queue interaction, tab semantics, theme persistence, and competition ingestion incident
      and mapping controls plus read-only replay previews; authenticated staging journeys and the
      remaining backend-connected critical flows still need coverage.
- [ ] Rehearse ingestion through standings for every sport and both league formats. Reconcile expected
      totals with scoring/data owners and retain signed results, including delayed and corrected data.
- [ ] Pass WCAG 2.2 AA review plus keyboard, focus, screen-reader, resize, contrast, reduced-motion,
      and touch-target testing. Complete supported-browser and physical iOS/Android testing.
      Automated axe WCAG A/AA checks now pass for ten representative routes at desktop and mobile
      web sizes; manual testing and formal review remain required.
- [ ] Meet the agreed performance gates: common API p95 near 500 ms, draft commit under one second at
      expected load, usable web near three seconds on typical broadband, and realtime score updates
      within five seconds. Load-test joins, draft contention, score fan-out, and standings updates.
- [ ] Validate push tickets/receipts, in-app fallback, deep links, moderation/retention, sponsor counts,
      privacy/data deletion, migration rollback/forward-fix, backup restore, and operational alerts.
- [ ] Require zero known Sev 1/2 defects and green scoring, authorization, concurrency, migration,
      restore, rollback, monitoring, content-rights, privacy, and admin-MFA evidence. Delay launch if
      any safe-core gate fails.

### Web launch and game-day readiness

- [ ] Publish approved privacy, terms, support, deletion, and delayed-data/status information; verify
      custom-domain DNS/TLS and production email flows; load approved production configuration/data.
- [ ] Rehearse deployment, rollback, scoring incident, provider outage, account support, moderation,
      backup restore, and the first-game checklist with the named owners.
- [ ] Preserve at least three uninterrupted hardening days. If unavailable, defer chat, sponsor
      metrics, waivers, and trades in that order; never cut security, scoring integrity, account
      deletion, auditing/backups, or draft correctness.
- [ ] On October 9, promote only the tested immutable build after the documented go/no-go. Monitor
      authentication and ingestion, reconcile the first game, communicate delays, and make scoring
      corrections through replay/audited adjustments rather than direct database edits.

### Mobile beta and submission

- [ ] Complete mobile layouts, physical-device accessibility, deep links, recovery, push permissions
      and delivery, offline/reconnect behavior, and TestFlight/Play internal testing.
- [ ] Create approved app name/copy, icons, screenshots, support/contact details, privacy labels,
      Google Data Safety answers, deletion resource, review notes/accounts, age/content declarations,
      and any rights documentation requested by the stores.
- [ ] Produce signed `.ipa` and `.aab` artifacts from the tested commit, verify package identifiers and
      production configuration, and upload review-ready packages by October 30. Record submission
      evidence; Apple/Google approval timing remains external.

### Stabilization and deferred work

- [ ] Monitor launch defects and provider corrections, activate basketball only after its approved
      opening schedule, and restore any cut features in this order: trades, waivers, sponsor metrics,
      then chat (the reverse of the cut order only when risk/owner approval permits).
- [ ] Keep rich/media chat, public leagues/social feeds, dynasty/keeper play, alternate draft formats,
      programmatic ads, paid contests/wagering, and broader analytics out of MVP unless a separately
      approved change updates scope, privacy, testing, and operations.

## Environment promotion rule

Local demo mode is visibly labelled. A production client refuses to start without Supabase public
configuration and a valid support email. Only server secret stores may contain provider credentials
or the Supabase service-role key. Production promotion must use a tested immutable commit and the
operations runbook; corrections use replay or an audited command, never direct total edits.
