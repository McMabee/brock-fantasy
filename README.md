# Brock Fantasy Sports

Universal web, iOS, and Android fantasy sports platform for Brock varsity athletics. The
application supports private leagues, head-to-head or points-leaderboard play, auditable scoring,
snake drafts, roster transactions, sponsor placements, and moderated league chat.

## Repository layout

- `apps/client` — Expo Router universal client.
- `packages/domain` — framework-independent domain contracts and deterministic scoring logic.
- `supabase` — PostgreSQL migrations, seed data, database tests, and Edge Functions.
- `docs` — architecture, domain, testing, operations, and decision records.

## Local development

Requirements: Node.js 22.12+ and pnpm 10.13+.

```bash
pnpm install
cp .env.example apps/client/.env.local
pnpm dev
```

Without Supabase variables, the client starts in clearly labelled demo mode. Demo mode is intended
for local UI development only and is rejected by production configuration validation.

Run the full verification suite with:

```bash
pnpm check
```

See `docs/operations.md` for environment, release, backup, and incident procedures.

## Delivery status

The repository contains the executable product foundation and safe-core/full-target workflows, but
the six teams remain deliberately inactive. Approved sport rules, sanctioned provider
payloads and rights, production Supabase/EAS projects, legal copy, support ownership, and store
accounts are external launch gates rather than values inferred by the application.

See `docs/release-readiness.md` for the implemented capability map, remaining evidence, and the
October 2/9/30 release decisions.

## Finish-work source of truth

Use these two documents to finish and release the product:

1. `docs/release-readiness.md` is the canonical checklist of every known unfinished product,
   approval, data, infrastructure, test, web-launch, and mobile-submission item.
2. `docs/operations.md` is the runbook for configuring environments, scheduling workers, deploying,
   monitoring, backing up, responding to incidents, and operating game days.

The other files in `docs` explain architecture, domain behavior, detailed test cases, privacy data,
and decisions. They support the two documents above but do not contain additional independent
finish-work items.
