begin;
create table public.dynamo_roster_source_runs(
 source text primary key check(source in ('dynamo','gymtots')),
 snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 started_at timestamptz not null,
 accounts integer not null check(accounts>0),members integer not null check(members>=0),
 staff integer not null check(staff>=0),gymnasts integer not null check(gymnasts>=0)
);
alter table public.dynamo_roster_source_runs enable row level security;
revoke all on public.dynamo_roster_source_runs from public,anon,authenticated;
grant select,insert,update on public.dynamo_roster_source_runs to service_role;
-- Preserve the current Dynamo-only baseline without copying member information.
insert into public.dynamo_roster_source_runs(source,snapshot_hash,started_at,accounts,members,staff,gymnasts)
select 'dynamo',snapshot_hash,started_at,accounts,members,staff,gymnasts from public.dynamo_roster_runs order by started_at desc limit 1;
create function public.apply_dynamo_rosters(p_hash text,p_started_at timestamptz,p_rows jsonb,p_sources jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; prior public.dynamo_roster_source_runs%rowtype; counts integer[]; result jsonb;
begin
 perform pg_advisory_xact_lock(719442001);
 if p_sources is null or jsonb_typeof(p_sources)<>'array' or jsonb_array_length(p_sources) not between 1 and 2
 or not exists(select 1 from jsonb_array_elements(p_sources) s where s->>'key'='dynamo')
 or exists(select 1 from jsonb_array_elements(p_sources) s where s->>'key' is null or s->>'key' not in ('dynamo','gymtots'))
 or (select count(distinct s->>'key') from jsonb_array_elements(p_sources) s)<>jsonb_array_length(p_sources)
 then raise exception 'ROSTER_SOURCE_MISSING';end if;
 if exists(select 1 from public.dynamo_roster_source_runs old where not exists(select 1 from jsonb_array_elements(p_sources) s where s->>'key'=old.source)) then raise exception 'ROSTER_SOURCE_MISSING';end if;
 for item in select value from jsonb_array_elements(p_sources) loop
  counts:=array[(item->>'accounts')::integer,(item->>'members')::integer,(item->>'staff')::integer,(item->>'gymnasts')::integer];
  if item->>'hash' is null or item->>'hash' !~ '^[a-f0-9]{64}$' or counts[1] is null or counts[1]<=0 or counts[2] is null or counts[2]<0 or counts[3] is null or counts[3]<0 or counts[4] is null or counts[4]<0 then raise exception 'SNAPSHOT_REVIEW_REQUIRED';end if;
  select * into prior from public.dynamo_roster_source_runs where source=item->>'key';
  if found then
   if p_started_at is null or p_started_at<=prior.started_at then raise exception 'STALE_SNAPSHOT';end if;
   if counts[1]<prior.accounts*.75 or counts[2]<prior.members*.75 or counts[4]<prior.gymnasts*.75 then raise exception 'SNAPSHOT_REVIEW_REQUIRED';end if;
  end if;
 end loop;
 -- The existing reconciler retains accounts, purchases, wallet and gymnast UUIDs.
 -- Its updates and the source baselines share this transaction and rollback together.
 result:=public.apply_dynamo_roster(p_hash,p_started_at,p_rows);
 for item in select value from jsonb_array_elements(p_sources) loop
  insert into public.dynamo_roster_source_runs(source,snapshot_hash,started_at,accounts,members,staff,gymnasts)
  values(item->>'key',item->>'hash',p_started_at,(item->>'accounts')::integer,(item->>'members')::integer,(item->>'staff')::integer,(item->>'gymnasts')::integer)
  on conflict(source) do update set snapshot_hash=excluded.snapshot_hash,started_at=excluded.started_at,accounts=excluded.accounts,members=excluded.members,staff=excluded.staff,gymnasts=excluded.gymnasts;
 end loop;
 return result;
end;
$$;
revoke all on function public.apply_dynamo_rosters(text,timestamptz,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_dynamo_rosters(text,timestamptz,jsonb,jsonb) to service_role;
-- Keep the existing retry logic while allowing a complete two-export run.
do $$
declare definition text;
begin
 select pg_get_functiondef(oid) into definition from pg_proc where proname='claim_dynamo_sync' and pronamespace='public'::regnamespace;
 if position('interval ''3 minutes''' in definition)=0 then raise exception 'Sync lock timeout patch requires review';end if;
 execute replace(definition,'interval ''3 minutes''','interval ''6 minutes''');
 select pg_get_functiondef(oid) into definition from pg_proc where proname='dispatch_dynamo_scheduled_sync' and pronamespace='public'::regnamespace;
 if position('timeout_milliseconds:=150000' in definition)=0 then raise exception 'Sync dispatcher timeout patch requires review';end if;
 execute replace(definition,'timeout_milliseconds:=150000','timeout_milliseconds:=300000');
end;
$$;
commit;
