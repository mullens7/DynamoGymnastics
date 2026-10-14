begin;set local role service_role;
do $test$
declare owner uuid:=gen_random_uuid();g uuid:=gen_random_uuid();e uuid:=gen_random_uuid();op uuid:=gen_random_uuid();r jsonb;items jsonb;begin
 insert into dynamo_accounts(id,email,wallet_pence) values(owner,'fee-fixture-'||owner||'@example.invalid',0);
 insert into dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,medical_details) values(g,owner,'manual:'||g,'Fee','Fixture','2020-01-01','None');
 insert into dynamo_events(id,details) values(e,'{"name":"Fee fixture","date":"2030-01-01","time":"10:00","capacity":2,"status":"Published","audience":"everyone","memberPriceCents":850,"nonMemberPriceCents":850}');
 items:=jsonb_build_array(jsonb_build_object('kind','event','targetId',e,'gymnastId',g,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb));
 r:=prepare_dynamo_card_checkout(owner,'basket',items,false,op,850,'acct_fixture');
 if (r->>'service_fee_pence')::bigint<>41 or (r->>'card_pence')::bigint<>850 then raise exception 'Wrong service fee or customer surcharge';end if;
 if (select sum(service_fee_pence) from dynamo_transactions where card_checkout_id=op)<>41 then raise exception 'Fee not recorded';end if;
 r:=prepare_dynamo_card_checkout(owner,'basket',items,false,op,850,'acct_fixture');if (r->>'service_fee_pence')::bigint<>41 then raise exception 'Fee retry changed';end if;
end $test$;rollback;
