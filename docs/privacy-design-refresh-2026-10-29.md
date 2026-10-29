# Privacy, support and rules design refresh

The fantasy app and association site share the expanded data minimization statement
and complete privacy policy. The generated documents use matching section cards,
table-of-contents links and responsive layouts, with each site's own colour palette.
Existing eligibility, retention periods, independent review and deletion limits remain
unchanged. Public support and privacy requests use `bfa.support64@gmail.com`.

Upcoming Games centres its paired table when space permits, retains horizontal
scrolling on phones and labels hockey, basketball and volleyball with sport icons.
The draft tab separates Live Snake and Scheduled Automatic modes into two cards,
with General Draft Rules below. The mode cards stack on phones.

The association's previous contact form displayed success locally. Its existing
submission implementation is now included so requests enter the service-email
outbox, preserve input on failure and distinguish queued, accepted and delivered
states. The production support recipient and association limiter configuration
were updated in Vercel. Credentials were kept out of source and browser bundles.
Read-only catalog checks confirmed the existing restricted database role can call
the contact queue, status and limiter functions; no migration was required.

## Local verification

- 112 policy layouts across both sites, both themes, phone and desktop widths,
  with no automated accessibility violations or browser errors
- 63 cookie, keyboard, privacy, contact, private-preference and draft-layout
  assertions, including separate mode cards and shared rules below them
- Responsive varsity browser coverage in both themes at 320, 390, 768 and 1440px,
  including centred fixture geometry and all three sport icons
- 21 focused configuration, contact/service-email and UI helper tests
- Association checks, 12 unit tests, compiled API runtime checks and 18
  Chromium/Firefox/WebKit desktop and phone browser cases
- Formatting, lint, type checks, policy source/output equality and public secret boundary
- Expo Android and iOS export compilation

Browser email providers are mocked. These checks do not establish real inbox
delivery. Hosted build and HTTP acceptance are checked separately after pushing.
The existing app import suite still requires private CSV fixtures absent from CI.
