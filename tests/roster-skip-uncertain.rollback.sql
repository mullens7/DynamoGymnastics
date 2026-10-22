begin;
select pg_advisory_xact_lock(719442001);
delete from public.dynamo_roster_source_runs;
delete from public.dynamo_roster_runs;
set local role service_role;
do $test$
declare batch text:=gen_random_uuid()::text; fixture_email text; rows jsonb; incoming jsonb; child jsonb; result jsonb; account uuid; original uuid; leaving uuid; purchase uuid;
begin
 fixture_email:='partial-'||batch||'@example.invalid';
 child:=jsonb_build_object('sourceId','derived:old-'||batch,'firstName','Short','lastName','Name','dateOfBirth','2020-01-02','bgNumber','','groups',jsonb_build_array('gymini'),'active',true,'timeClass','Gymini');
 rows:=jsonb_build_array(jsonb_build_object('email',fixture_email,'ownerName','Fixture','member',true,'staff',false,'gymnasts',jsonb_build_array(child,jsonb_set(jsonb_set(child,'{sourceId}',to_jsonb('derived:leaving-'||batch)),'{dateOfBirth}','"2021-01-02"'))));
 perform public.apply_dynamo_roster(md5(batch)||md5('1'),now(),rows);
 select id into account from public.dynamo_accounts where email=fixture_email;
 select id into original from public.dynamo_gymnasts where source_id='derived:old-'||batch;
 select id into leaving from public.dynamo_gymnasts where source_id='derived:leaving-'||batch;
 update public.dynamo_accounts set wallet_pence=1234 where id=account;
 update public.dynamo_gymnasts set medical_details='Retained' where id=original;
 insert into public.dynamo_purchases(account_id,details) values(account,'{"name":"Retained"}') returning id into purchase;
 incoming:=jsonb_set(rows,'{0,gymnasts}',jsonb_build_array(jsonb_set(jsonb_set(child,'{sourceId}',to_jsonb('derived:changed-'||batch)),'{firstName}','"Expanded Name"'),jsonb_set(jsonb_set(jsonb_set(child,'{sourceId}',to_jsonb('derived:new-'||batch)),'{dateOfBirth}','"2022-01-02"'),'{firstName}','"New Child"')));
 result:=public.apply_dynamo_roster(md5(batch)||md5('2'),now()+interval '1 second',incoming);
 if jsonb_array_length(result->'skippedRecords')<>1 then raise exception 'Expected one skipped record: %',result;end if;
 if not exists(select 1 from public.dynamo_gymnasts where id=original and first_name='Short' and active and medical_details='Retained') or not exists(select 1 from public.dynamo_gymnasts where source_id='derived:new-'||batch and active) or exists(select 1 from public.dynamo_gymnasts where id=leaving and active) or exists(select 1 from public.dynamo_gymnasts where source_id='derived:changed-'||batch) then raise exception 'Partial import changed uncertain record or lost valid changes';end if;
 if not exists(select 1 from public.dynamo_purchases where id=purchase and account_id=account) or (select wallet_pence from public.dynamo_accounts where id=account)<>1234 then raise exception 'History lost';end if;
 result:=public.apply_dynamo_roster(md5(batch)||md5('2'),now()+interval '2 seconds',incoming);
 if result->>'unchanged'<>'true' or jsonb_array_length(result->'skippedRecords')<>1 then raise exception 'Repeated skip not stable';end if;
 -- Bad exported DOB/name flags protect existing imported children on that owner.
 incoming:=jsonb_set(incoming,'{0,preserveExisting}','true');
 incoming:=jsonb_set(incoming,'{0,gymnasts}',jsonb_build_array(incoming#>'{0,gymnasts,1}'));
 -- Retain snapshot counts for this fixture to exercise preservation without the bulk-loss guard.
 update public.dynamo_roster_runs set gymnasts=1;
 result:=public.apply_dynamo_roster(md5(batch)||md5('3'),now()+interval '3 seconds',incoming);
 if not exists(select 1 from public.dynamo_gymnasts where id=original and active) then raise exception 'Invalid-row preservation failed';end if;
end $test$;
rollback;
