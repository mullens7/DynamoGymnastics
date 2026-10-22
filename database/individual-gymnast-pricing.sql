begin;
-- An owner's membership never grants a sibling a discounted ticket or party.
create or replace function public.dynamo_gymnast_is_member(p_account uuid,p_gymnast uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.dynamo_gymnasts where id=p_gymnast and account_id=p_account and active and cardinality(groups)>0)
$$;
revoke all on function public.dynamo_gymnast_is_member(uuid,uuid) from public,anon,authenticated;
grant execute on function public.dynamo_gymnast_is_member(uuid,uuid) to service_role;
do $$declare f record;definition text;changed text;n integer:=0;begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('book_dynamo_session','book_dynamo_session_v2','book_dynamo_party_counted','dynamo_expand_event_selection','checkout_dynamo_basket') loop
  definition:=pg_get_functiondef(f.oid);changed:=definition;
  if f.proname in ('book_dynamo_session','book_dynamo_session_v2','book_dynamo_party_counted') then
   changed:=replace(changed,'public.dynamo_account_is_member(account.id)','public.dynamo_gymnast_is_member(p_account,p_gymnast)');
  elsif f.proname='dynamo_expand_event_selection' then
   changed:=replace(changed,'member boolean:=public.dynamo_account_is_member(p_account)','member boolean:=public.dynamo_gymnast_is_member(p_account,(p_item->>''gymnastId'')::uuid)');
  else
   changed:=replace(changed,'select public.dynamo_account_is_member(id) into member from public.dynamo_accounts where id=p_account for update;','perform id from public.dynamo_accounts where id=p_account for update;');
   changed:=replace(changed,'public.dynamo_party_price((item->>''targetId'')::uuid,member,','public.dynamo_party_price((item->>''targetId'')::uuid,public.dynamo_gymnast_is_member(p_account,(item->>''gymnastId'')::uuid),');
  end if;
  if changed=definition then raise exception 'Pricing function % has changed; review required',f.proname;end if;
  execute changed;n:=n+1;
 end loop;
 if n<>5 then raise exception 'Expected five pricing functions, found %',n;end if;
end $$;
commit;
