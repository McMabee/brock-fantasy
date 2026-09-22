# Domain Model

## Competition and rules

A competition identifies one sport, division, and season. Six initial teams share three
sport-specific rule engines. Each competition references a versioned ruleset containing scoring,
roster slots, draft timing, transactions, matchup periods, and tiebreakers. Only approved rulesets
may be used to create a league.

A league pins its competition, format, and ruleset. Format and ruleset become immutable once its
draft begins. Membership is private and controlled by a case-insensitive invite code.

## Draft and roster

Draft state is server-authoritative. The database locks the draft row, calculates the expected team
from the persisted snake order, enforces one athlete per league, commits the pick and roster entry,
and advances the deadline in one transaction. Idempotency keys make client retries safe.

Roster changes are append-only transactions. An active-owner partial unique index prevents an
athlete from being owned by two teams in the same league. Lineups are snapshotted per game before
the game lock so later trades cannot rewrite historical scoring ownership.

## Statistics and scoring

Every provider revision is stored immutably. Provider IDs map to internal game and athlete IDs;
unmapped athletes create reconciliation errors and are not scored. Normalized stats store the latest
known state, while `stat_revisions` records corrections.

`replay_game` compares the target points for the current normalized line against existing automated
point events. Differences become compensating correction events. It never edits earlier point
events, and administrative adjustments remain distinct from automated scoring.

## Social and sponsorship

Chat is private to a league, text-only, rate limited, reportable, and mutable only through trusted
commands. Mutes are per user. Hidden messages remain available to administrators for audit.

Sponsor campaigns have fixed placements and active windows. Metrics contain aggregate daily counts
only and must not carry user identifiers.
