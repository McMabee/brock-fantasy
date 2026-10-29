set local lock_timeout='2s';
set local statement_timeout='30s';

-- - Provide asynchronous HTTP to the existing private email dispatcher
-- - Keep Supabase-managed extension ownership and permissions intact
create extension if not exists pg_net;
