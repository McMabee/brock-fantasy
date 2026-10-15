begin;
select plan(8);

select has_function('public', 'consume_rate_limit', array['text', 'integer', 'integer'], 'rate-limit RPC signature matches the app');
select function_returns('public', 'consume_rate_limit', array['text', 'integer', 'integer'], 'boolean', 'rate-limit RPC returns boolean');
select ok(has_function_privilege('service_role', 'public.consume_rate_limit(text,integer,integer)', 'EXECUTE'), 'server role can consume rate limits');
select ok(not has_function_privilege('anon', 'public.consume_rate_limit(text,integer,integer)', 'EXECUTE'), 'anonymous clients cannot consume rate limits');
select ok(not has_function_privilege('authenticated', 'public.consume_rate_limit(text,integer,integer)', 'EXECUTE'), 'signed-in clients cannot consume rate limits');
select ok(not has_schema_privilege('anon', 'beta_private', 'USAGE'), 'counter schema is private');

-- One isolated bucket; all writes roll back. A long window avoids minute-boundary flakes.
select set_config('test.rate_key', gen_random_uuid()::text, true);
set local role service_role;
select is(public.consume_rate_limit(current_setting('test.rate_key'), 1, 86400), true, 'first request is allowed');
select is(public.consume_rate_limit(current_setting('test.rate_key'), 1, 86400), false, 'second request is atomically counted and denied');
reset role;

select * from finish();
rollback;
