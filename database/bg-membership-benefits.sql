begin;
create or replace function public.dynamo_gymnast_is_member(p_account uuid,p_gymnast uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.dynamo_gymnasts g where g.id=p_gymnast and g.account_id=p_account and g.active and cardinality(g.groups)>0
 and (not exists(select 1 from unnest(g.groups) label where label not in ('under_2_years','two_years','under_4_years'))
 or (nullif(btrim(g.bg_number),'') is not null and g.bg_expiry_date >= (now() at time zone 'Europe/London')::date)))
$$;
revoke all on function public.dynamo_gymnast_is_member(uuid,uuid) from public,anon,authenticated;
grant execute on function public.dynamo_gymnast_is_member(uuid,uuid) to service_role;
do $migration$
declare f record;definition text;changed text;n integer:=0;
begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('book_dynamo_session','book_dynamo_session_v2','book_dynamo_party_counted','book_dynamo_event_priced','manage_dynamo_booking','move_dynamo_event_booking') loop
  definition:=pg_get_functiondef(f.oid);
  changed:=replace(definition,'gym.id is null or not gym.active or cardinality(gym.groups)=0','not public.dynamo_gymnast_is_member(gym.account_id,gym.id)');
  if changed=definition then raise exception 'Eligibility function % changed; review required',f.proname;end if;
  execute changed;n:=n+1;
 end loop;
 if n<>6 then raise exception 'Expected six eligibility functions';end if;
end $migration$;
commit;
