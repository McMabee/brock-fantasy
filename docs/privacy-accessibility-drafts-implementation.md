# Privacy, accessibility, and automatic drafting release

Approved scope: both web properties, consistent existing spacing and typography,
no tracking, optional theme storage, private preference-based automatic drafts,
and the category limits in the existing proposed retention schedule

## Implementation and evidence

- [x] Shared cookie contract, accessible banner/settings, preference-gated theme storage
- [x] Accurate public policies, minimization statement, legal applicability register
- [x] Real contact/feedback submission, durable service-email outbox and suppression
- [x] Contrast, keyboard, focus, image alternatives and responsive layout review
- [x] Bounded retention jobs, holds, deletion replay and backup expiry controls
- [x] Required draft mode, private preparation, automatic worker and status UI
- [x] Database contracts, concurrency, HTTP, browser and accessibility regressions
- [ ] Hosted rollout evidence and immediate observation

October 25 audit: the three database migrations are installed in production with
protected gameplay unchanged and optional release controls disabled. Both clients
are staged for review. Policy publication, real service-mail acceptance, manual
screen-reader acceptance and the activation/observation gates remain open. See
[the release audit](league-entry-release-audit-2026-10-25.md) for exact deployment
and verification status, including the separate live BFA/late-entry release.

## External acceptance gates

- Policy wording and jurisdiction applicability review before approved publication
- Actual contact and draft email delivery with tracking disabled at the provider
- Representative manual screen-reader acceptance
- Verified backup/restore before hosted migrations and retention activation
- Twenty-four-hour hosted observation after release

Local checks and implementation are recorded separately from these gates
Current active/completed drafts and earned points must be preserved
No new automatic draft may run before hosted acceptance enables its release flag
