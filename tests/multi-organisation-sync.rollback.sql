begin;
select pg_advisory_xact_lock(719442001);
delete from public.dynamo_roster_source_runs;
delete from public.dynamo_roster_runs;
set local role service_role;
do $test$
declare batch text:=replace(gen_random_uuid()::text,'-',''); parent_email text; rows jsonb; sources jsonb; r jsonb; account uuid; child_id uuid; purchase uuid; stable uuid; before_sources jsonb;
begin
 parent_email:='multi-'||batch||'@example.invalid';
 select jsonb_build_array(jsonb_build_object('email',parent_email,'ownerName','Fixture Parent','member',true,'staff',false,'gymnasts',jsonb_agg(jsonb_build_object('sourceId','derived:'||batch||md5(i::text),'firstName','Fixture'||batch||i,'lastName','Child','dateOfBirth','2020-01-01','bgNumber','','timeClass','Gymini | Gymtots','groups',jsonb_build_array('gymini','gymtots'),'active',true)))) into rows from generate_series(1,4) i;
 sources:=jsonb_build_array(jsonb_build_object('key','dynamo','hash',repeat('1',64),'accounts',1,'members',1,'staff',0,'gymnasts',4),jsonb_build_object('key','gymtots','hash',repeat('2',64),'accounts',1,'members',1,'staff',0,'gymnasts',4));
 r:=public.apply_dynamo_rosters(repeat('3',64),now(),rows,sources);
 select id into account from public.dynamo_accounts a where a.email=parent_email;
 select id into child_id from public.dynamo_gymnasts where account_id=account order by id limit 1;
 update public.dynamo_accounts set wallet_pence=1234 where id=account;
 update public.dynamo_gymnasts set medical_details='Fixture medical details' where id=child_id;
 insert into public.dynamo_purchases(account_id,details) values(account,'{"name":"Retained fixture purchase","kind":"event"}') returning id into purchase;
 r:=public.apply_dynamo_rosters(repeat('3',64),now()+interval '1 second',rows,sources);
 if not (r->>'unchanged')::boolean then raise exception 'Repeated union was not idempotent';end if;
 if (select count(*) from public.dynamo_gymnasts where account_id=account)<>4 or not exists(select 1 from public.dynamo_gymnasts where id=child_id and medical_details='Fixture medical details') or (select wallet_pence from public.dynamo_accounts where id=account)<>1234 or not exists(select 1 from public.dynamo_purchases where id=purchase) then raise exception 'Profiles or history changed';end if;
 select jsonb_agg(to_jsonb(s) order by source) into before_sources from public.dynamo_roster_source_runs s;
 begin
  perform public.apply_dynamo_rosters(repeat('3',64),now()+interval '2 seconds',rows,jsonb_build_array(sources->0));
  raise exception 'Missing organisation accepted';
 exception when others then if sqlerrm<>'ROSTER_SOURCE_MISSING' then raise;end if;end;
 begin
  perform public.apply_dynamo_rosters(repeat('3',64),now()+interval '2 seconds',rows,jsonb_set(sources,'{1,gymnasts}','2'));
  raise exception 'Partial second export accepted';
 exception when others then if sqlerrm<>'SNAPSHOT_REVIEW_REQUIRED' then raise;end if;end;
 if (select jsonb_agg(to_jsonb(s) order by source) from public.dynamo_roster_source_runs s)<>before_sources then raise exception 'Source guards mutated baselines';end if;
 if not exists(select 1 from public.dynamo_gymnasts where id=child_id and active) then raise exception 'Guard lost active membership';end if;
end;
$test$;
rollback;
