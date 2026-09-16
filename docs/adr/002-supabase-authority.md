# ADR-002: Supabase and PostgreSQL authority

Status: Accepted

Use Supabase Auth, PostgreSQL, Realtime, and short Edge Functions. Transactions, constraints, RLS,
and trusted functions make draft/scoring state server-authoritative. Staging and production use
separate projects. Revisit if institutional approval, scale tests, or cost invalidate the service.
