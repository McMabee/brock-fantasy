# ADR-004: Append-only point-ledger scoring

Status: Accepted

Preserve provider revisions and normalized statistics, then record point deltas as immutable events.
Official corrections create compensating events; explicit admin adjustments carry an actor and
reason. Replays must converge on the same total without rewriting history.
