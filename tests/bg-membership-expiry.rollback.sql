begin;
select pg_advisory_xact_lock(719442001);
delete from public.dynamo_roster_runs;
do $test$
declare rows jsonb; child jsonb; source text:='expiry-test:'||gen_random_uuid(); email text:='expiry-test-'||gen_random_uuid()||'@example.invalid'; saved date;
begin
 child:=jsonb_build_object('sourceId',source,'firstName','Expiry','lastName','Fixture','dateOfBirth','2018-01-01','groups',jsonb_build_array('gymini'),'active',true,'bgNumber','TEST','bgExpiryDate','2027-09-01');
 rows:=jsonb_build_array(jsonb_build_object('email',email,'member',true,'staff',false,'gymnasts',jsonb_build_array(child)));
 perform public.apply_dynamo_roster(repeat('a',64),now(),rows);
 select bg_expiry_date into saved from public.dynamo_gymnasts where source_id=source;
 if saved is distinct from date '2027-09-01' then raise exception 'Expiry not imported';end if;
 rows:=jsonb_set(rows,'{0,gymnasts,0}',child-'bgExpiryDate');
 perform public.apply_dynamo_roster(repeat('b',64),now()+interval '1 second',rows);
 select bg_expiry_date into saved from public.dynamo_gymnasts where source_id=source;
 if saved is distinct from date '2027-09-01' then raise exception 'Missing column erased expiry';end if;
 rows:=jsonb_set(rows,'{0,gymnasts,0,bgExpiryDate}','"2028-09-01"');
 perform public.apply_dynamo_roster(repeat('c',64),now()+interval '2 second',rows);
 select bg_expiry_date into saved from public.dynamo_gymnasts where source_id=source;
 if saved is distinct from date '2028-09-01' then raise exception 'Renewal not imported';end if;
end $test$;
rollback;
