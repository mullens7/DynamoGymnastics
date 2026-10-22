begin;
select pg_advisory_xact_lock(719442001);
delete from public.dynamo_roster_source_runs;
delete from public.dynamo_roster_runs;
set local role service_role;
do $test$
declare rows jsonb; sources jsonb; answer jsonb; before_accounts bigint; before_active bigint; fixture_email text:='preview-'||gen_random_uuid()||'@example.invalid';
begin
 select count(*) into before_accounts from public.dynamo_accounts;
 select count(*) into before_active from public.dynamo_gymnasts where active;
 rows:=jsonb_build_array(jsonb_build_object('email',fixture_email,'ownerName','Preview','member',true,'staff',false,'gymnasts',jsonb_build_array(jsonb_build_object('sourceId','preview:'||gen_random_uuid(),'firstName','Preview','lastName','Child','dateOfBirth','2020-01-01','groups',jsonb_build_array('gymini'),'active',true))));
 sources:=jsonb_build_array(jsonb_build_object('key','dynamo','hash',repeat('a',64),'accounts',1,'members',1,'staff',0,'gymnasts',1));
 answer:=public.preview_dynamo_rosters(repeat('b',64),now(),rows,sources);
 if answer->>'ok'<>'true' then raise exception 'Preview failed: %',answer;end if;
 if exists(select 1 from public.dynamo_accounts where email=fixture_email) or (select count(*) from public.dynamo_accounts)<>before_accounts or (select count(*) from public.dynamo_gymnasts where active)<>before_active or exists(select 1 from public.dynamo_roster_runs) or exists(select 1 from public.dynamo_roster_source_runs) then raise exception 'Preview changed data';end if;
 if has_function_privilege('anon','public.preview_dynamo_rosters(text,timestamptz,jsonb,jsonb)','execute') or has_function_privilege('authenticated','public.preview_dynamo_rosters(text,timestamptz,jsonb,jsonb)','execute') then raise exception 'Preview exposed';end if;
end $test$;
rollback;
