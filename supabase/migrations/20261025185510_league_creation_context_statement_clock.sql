set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- - Use one consistent statement time throughout the stable creation-context read
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('rpc_private.get_league_creation_context()'::regprocedure);
  if position('clock_timestamp()' in definition)=0 then raise exception 'Expected creation-context clock';end if;
  execute replace(definition,'clock_timestamp()','statement_timestamp()');
end;
$migration$;

notify pgrst,'reload schema';
