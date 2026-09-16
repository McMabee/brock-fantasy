# Architecture

## Runtime topology

The Expo Router client runs on web, iOS, and Android. It authenticates with Supabase Auth using the
public anonymous key. PostgreSQL is the canonical state store; Realtime broadcasts committed draft,
score, notification, and chat changes. Edge Functions perform privileged provider ingestion and
account deletion.

```text
Approved provider / audited admin import
  -> ingest-sports-data Edge Function
  -> immutable provider_snapshots
  -> provider mappings + normalized_player_game_stats
  -> replay_game trusted database command
  -> append-only fantasy_point_events
  -> matchup totals + Realtime
  -> Expo client
```

## Authority boundaries

- The client proposes actions and renders committed state. It never awards points, chooses another
  manager's draft pick, grants roles, or finalizes a game.
- User commands run through narrowly granted `security definer` database functions. Direct writes to
  point, audit, idempotency, and provider tables are revoked.
- Provider credentials and the Supabase service-role key exist only in server secret stores.
- RLS scopes private reads to league membership and privileged operational reads to administrators.
- Internal UUIDs remain independent of provider identifiers.

## Workspace

- `apps/client`: presentation, navigation, session state, and typed command calls.
- `packages/domain`: pure scoring, roster, draft, standings, and provider contracts.
- `supabase`: migrations, trusted functions, policies, seed configuration, fixtures, and Edge
  Functions.

The client has a local demo mode when Supabase variables are absent. A production environment fails
fast if either public Supabase value is missing. Demo data is synthetic and must never be promoted as
official athlete or scoring data.
