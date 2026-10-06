# Public policy drafts

**Drafted:** October 6, 2026  
**Version:** 0.1  
**Status:** Working drafts for operator review; not effective or approved for publication.

These documents describe Brock Fantasy's free, ad-free fantasy-sports web beta for private leagues involving Brock varsity athletics. They include conventional service terms and Canadian privacy practices, adapted to the repository. They are starting points for review, not a finding of legal compliance or evidence of a live deployment.

## Documents

| Requested document      | Draft                                                             |
| ----------------------- | ----------------------------------------------------------------- |
| Privacy policy          | [Privacy policy](privacy-notice.md)                               |
| Terms and conditions    | [Terms and conditions](terms-of-use.md)                           |
| Support policy          | [Support policy](support-policy.md)                               |
| Account-deletion policy | [Account-deletion policy](account-deletion-notice.md)             |
| Moderation policy       | [Community moderation policy](community-moderation-guidelines.md) |
| Delayed-data policy     | [Delayed-data and corrections policy](delayed-data-notice.md)     |
| Availability notice     | [Availability notice](availability-notice.md)                     |
| Data retention schedule | [Data retention schedule](data-retention-schedule.md)             |

Existing filenames are retained so references to these drafts continue to work. The application currently displays separate summaries in its privacy, terms, and deletion screens; editing these files does not publish or update those screens.

## Repository basis and limits

The scan covered the application routes, authentication and notification code, database migrations and permissions, Edge Functions, and domain, privacy, operations, and release documentation. No hosted configuration, provider contracts, or operational controls were verified.

| Repository evidence                                                                                                                                                                                     | Effect on the drafts                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Product overview](../../README.md), [release readiness](../release-readiness.md), and [disabled advertising](../../supabase/migrations/20261002005000_disable_beta_advertising.sql)                    | Free private-league beta, no advertising or real-money contests; data activation remains subject to approval.                                                                                                                         |
| [Web session code](../../apps/client/src/server/session.ts) and [authentication routes](../../apps/client/src/app/api/auth/%5Baction%5D+api.ts)                                                         | Necessary session/security cookies and actual browser expiry periods; hosting and Auth server retention are unconfirmed.                                                                                                              |
| [Account screen](../../apps/client/src/app/account.tsx), [deletion function](../../supabase/functions/delete-account/index.ts), and [schema](../../supabase/migrations/202609150001_initial_schema.sql) | Successful deletion cascades to account-owned records, but chat bodies, team names, audit payloads, and historical league data can remain identifiable. Clearing an author/owner reference is not complete anonymization.             |
| [Source import schema](../../supabase/migrations/20261001230524_web_beta_foundation.sql)                                                                                                                | A source import's `imported_by` reference has no deletion action. An importing administrator's deletion can be blocked; resolve this through a reviewed operational/schema change before promising universal self-service completion. |
| [Moderation command](../../supabase/migrations/202609150008_operations_commands.sql) and league chat UI                                                                                                 | Report/mute tools and audited message hiding exist; complete suspension, notification, and appeal operations still require verification.                                                                                              |
| [Operations runbook](../operations.md) and notification code                                                                                                                                            | Audited score corrections and optional native push are designed; native distribution, provider cadence, support staffing, and backup expiry are not proven.                                                                           |

No general time-based retention cleanup was found. The proposed retention periods, support targets, appeal process, notice periods, and restore handling below require approval and implementation. They must not be presented as current guarantees.

## Decisions before publication

Tarik Merchant is the recorded owner for privacy/legal, data/rules, accessibility, support, and game-day operations. Ty Mabee is the recorded release and security-incident owner.

- Fill in the legal operator, mailing address, effective dates, and monitored support/privacy/security contacts. Do not publish the example address from environment templates.
- Confirm the operator's relationship to Brock University and permission to use names, logos, and athlete data. Branding alone does not establish affiliation.
- Approve the minimum age and service territory. A Canada-focused, adults-only beta is a conservative proposed starting point, not an implemented eligibility restriction. Any youth launch needs an age-appropriate consent process.
- Confirm applicable privacy law based on the operator and activities. PIPEDA is a drafting baseline; applicability depends on the activities, including their commercial character, rather than free/nonprofit status alone. See the OPC's [commercial-activity guidance](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda-compliance-help/pipeda-interpretation-bulletins/interpretations_03_ca/).
- Approve Ontario governing law and the conservative liability wording with the operator's legal reviewer.
- Approve support capacity, moderation authority, appeal handling, outage communication channels, and the proposed response/notice targets.
- List actual providers, processing countries, backup copies, contractual deletion terms, and data-source permissions.
- Implement and verify retention cleanup, residual-text review, administrative-account deletion, session revocation, and deletion reapplication after restore. Coordinate expiry of scoring inputs and derived history so retained results remain explainable.
- Publish accessible full policies, link them from account creation and account settings, record the accepted Terms version, and separately obtain meaningful privacy consent where needed. Retain approved versions and review at least annually.

## Drafting references

Privacy purposes and consent were informed by the OPC's [meaningful-consent guidance](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/collecting-personal-information-and-consent/consent/gl_omc_201805/). Cross-border transparency follows the OPC's [outsourcing guidance](https://www.priv.gc.ca/en/privacy-topics/employers-and-employees/outsourcing/02_05_d_57_os_01/).

Retention uses purpose-based limits rather than a claimed universal industry period, consistent with the OPC's [retention and disposal guidance](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/gd_rd_201406/). Numeric operational periods are proposals unless identified as a legal minimum. The privacy and retention drafts cite the specific access and breach-record requirements.

The Terms preserve mandatory consumer rights, consistent with [Ontario's Consumer Protection Act, 2002, section 7](https://www.ontario.ca/laws/statute/02c30). Applicability and the law in force must be checked before publication.
