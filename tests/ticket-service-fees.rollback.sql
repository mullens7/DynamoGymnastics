begin;set local role service_role;
do $test$
declare owner uuid:=gen_random_uuid();g1 uuid:=gen_random_uuid();g2 uuid:=gen_random_uuid();e uuid;op uuid:=gen_random_uuid();r jsonb;items jsonb:='[]';n integer;g uuid;begin
 if public.dynamo_ticket_service_fee(850,1)<>41 or public.dynamo_ticket_service_fee(8500,10)<>413 or public.dynamo_ticket_service_fee(0,10)<>0 or public.dynamo_ticket_service_fee(30,10)<>30 then raise exception 'Incorrect fee arithmetic';end if;
 insert into dynamo_accounts(id,email,wallet_pence) values(owner,'fee-ten-'||owner||'@example.invalid',0);
 foreach g in array array[g1,g2] loop insert into dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,medical_details) values(g,owner,'manual:'||g,'Fee','Fixture','2020-01-01','None');end loop;
 for n in 1..5 loop e:=gen_random_uuid();insert into dynamo_events(id,details) values(e,jsonb_build_object('name','Fee fixture','date','2030-01-0'||n,'time','10:00','capacity',10,'status','Published','audience','everyone','memberPriceCents',850,'nonMemberPriceCents',850));
 foreach g in array array[g1,g2] loop items:=items||jsonb_build_array(jsonb_build_object('kind','event','targetId',e,'gymnastId',g,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb));end loop;end loop;
 r:=prepare_dynamo_card_checkout(owner,'basket',items,false,op,8500,'acct_fixture');
 if (r->>'service_fee_pence')::bigint<>413 or jsonb_array_length(r->'result'->'bookings')<>10 or (r->>'card_pence')::bigint<>8500 then raise exception 'Ten-ticket fee incorrect: %',r;end if;
 if (select sum(service_fee_pence) from dynamo_transactions where card_checkout_id=op)<>413 then raise exception 'Fee allocation mismatch';end if;
 r:=prepare_dynamo_card_checkout(owner,'basket',items,false,op,8500,'acct_fixture');if (r->>'service_fee_pence')::bigint<>413 then raise exception 'Retry changed fee';end if;
end $test$;rollback;
select 'ten_ticket_fee_and_idempotency_passed' as result;
