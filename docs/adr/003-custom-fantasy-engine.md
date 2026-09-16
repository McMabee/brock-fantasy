# ADR-003: Custom fantasy engine

Status: Accepted

No usable Fantasizr API access exists. Build league, draft, roster, transaction, scoring, matchup,
and standings authority in PostgreSQL rather than creating dual authority or a fragile integration.
Revisit only if a future API provides full workflows, corrections, export, and acceptable terms.
