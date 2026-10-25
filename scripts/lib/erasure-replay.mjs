const tables = {
  account: 'auth.users',
  league: 'public.leagues',
  source_import: 'public.source_imports',
  season: 'public.fantasy_seasons',
};
export function validateErasureManifest(input, now = Date.now()) {
  if (
    !input ||
    !Array.isArray(input.entries) ||
    input.entries.length > 100000 ||
    !Number.isFinite(Date.parse(input.capturedAt)) ||
    now - Date.parse(input.capturedAt) > 3600000 ||
    Date.parse(input.capturedAt) > now + 60000
  )
    throw new Error('A deletion manifest captured within the last hour is required');
  for (const entry of input.entries)
    if (
      !Object.hasOwn(tables, entry.kind) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(entry.id)
    )
      throw new Error('Invalid deletion manifest entry');
  return {
    capturedAt: new Date(input.capturedAt).toISOString(),
    entries: input.entries.map(({ kind, id }) => ({ kind, id })),
  };
}

export function erasureReplaySql(input) {
  const manifest = validateErasureManifest(input);
  // - Replay only into the caller's isolated restored database before any application access
  return `
  create or replace function pg_temp.replay_erasure_tree(relation regclass, predicate text, depth integer default 0) returns bigint language plpgsql set search_path='' as $replay$
  declare targets tid[]; fk record; joined text; child_predicate text; remaining boolean; removed bigint:=0; n bigint;
  begin
    if depth>32 then raise exception 'Deletion replay dependency depth exceeded';end if;
    execute format('select array_agg(ctid)from(select t.ctid from %s t where %s limit 250)q',relation,predicate)into targets;
    if targets is null then return 0;end if;
    for fk in select conrelid::regclass child,conkey,confkey from pg_constraint where contype='f'and confrelid=relation and confdeltype not in('n','d')loop
      select string_agg(format('t.%I=p.%I',c.attname,p.attname),' and 'order by k.n)into joined
        from unnest(fk.conkey,fk.confkey)with ordinality k(child_key,parent_key,n)
        join pg_attribute c on c.attrelid=fk.child and c.attnum=k.child_key
        join pg_attribute p on p.attrelid=relation and p.attnum=k.parent_key;
      child_predicate:=format('exists(select 1 from %s p where p.ctid=any(%L::tid[])and %s)',relation,targets::text,joined);
      loop
        removed:=removed+pg_temp.replay_erasure_tree(fk.child,child_predicate,depth+1);
        execute format('select exists(select 1 from %s t where %s)',fk.child,child_predicate)into remaining;
        exit when not remaining;
      end loop;
    end loop;
    execute format('delete from %s where ctid=any(%L::tid[])',relation,targets::text);
    get diagnostics n=row_count;return removed+n;
  end;$replay$;
  do $apply$declare entry jsonb; relation regclass;remaining boolean;begin
    for entry in select * from jsonb_array_elements('${JSON.stringify(manifest.entries)}'::jsonb)loop
      relation:=to_regclass(case entry->>'kind'when 'account'then'auth.users'when'league'then'public.leagues'when'source_import'then'public.source_imports'when'season'then'public.fantasy_seasons'end);
      if relation is null then continue;end if;
      loop
        perform pg_temp.replay_erasure_tree(relation,format('t.id=%L::uuid',entry->>'id'));
        execute format('select exists(select 1 from %s where id=%L::uuid)',relation,entry->>'id')into remaining;
        exit when not remaining;
      end loop;
    end loop;
  end;$apply$;
  `;
}
