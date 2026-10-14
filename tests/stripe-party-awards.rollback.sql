begin;set local role service_role;
do $test$
declare owner uuid:=gen_random_uuid();g uuid:=gen_random_uuid();slot uuid:=gen_random_uuid();award uuid:=gen_random_uuid();op uuid:=gen_random_uuid();op2 uuid:=gen_random_uuid();booking uuid;items jsonb;price bigint;r jsonb;begin
 insert into public.dynamo_accounts(id,email,roster_member,wallet_pence) values(owner,'card-party-award-'||owner||'@example.invalid',true,0);
 insert into public.dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,medical_details,groups,active,time_class) values(g,owner,'manual:'||g,'Card','Fixture','2024-01-01','None','{gymini}',true,'Thursday 4.00-5.00, Gymini');
 insert into public.dynamo_parties(id,details) values(slot,'{"name":"Card fixture party","date":"2030-01-06","time":"13:00","room":"Big gym","partyType":"dynamo","guests":25,"status":"Pending","memberPriceCents":20000,"nonMemberPriceCents":20000}');
 items:=jsonb_build_array(jsonb_build_object('kind','party','targetId',slot,'gymnastId',g,'roomAddon',false,'partyDetails',jsonb_build_object('contactNumber','07712 345678','numberOfChildren',10)));price:=public.dynamo_party_price(slot,true,false);
 r:=public.prepare_dynamo_card_checkout(owner,'basket',items,false,op,price,'acct_fixture');booking:=(r->'result'->'bookings'->0->>'bookingId')::uuid;
 if exists(select 1 from public.dynamo_party_alerts where booking_id=booking) or not(select payment_pending from public.dynamo_party_bookings where id=booking) then raise exception 'Party premature';end if;
 perform public.attach_dynamo_card_session(op,'cs_partyfixture',now()+interval '31 minutes');perform public.settle_dynamo_card_checkout(op,'cs_partyfixture','pi_partyfixture',price,true);
 if not exists(select 1 from public.dynamo_party_alerts where booking_id=booking) or (select payment_pending from public.dynamo_party_bookings where id=booking) then raise exception 'Party payment settlement';end if;
 insert into public.dynamo_awards(id,details) values(award,'{"name":"Card fixture award","category":"gymini","enabled":true,"priceCents":400,"position":1}');
 items:=jsonb_build_array(jsonb_build_object('gymnastId',g,'awardId',award,'expectedSession','Thursday 4.00-5.00, Gymini'));
 r:=public.prepare_dynamo_card_checkout(owner,'awards',items,false,op2,400,'acct_fixture');if not(select payment_pending from public.dynamo_award_orders where id=op2) then raise exception 'Award premature';end if;
 perform public.attach_dynamo_card_session(op2,'cs_awardfixture',now()+interval '31 minutes');perform public.settle_dynamo_card_checkout(op2,'cs_awardfixture',null,400,false);
 if exists(select 1 from public.dynamo_award_items where order_id=op2) then raise exception 'Unpaid award item retained';end if;
 op2:=gen_random_uuid();r:=public.prepare_dynamo_card_checkout(owner,'awards',items,false,op2,400,'acct_fixture');perform public.attach_dynamo_card_session(op2,'cs_awardfixture2',now()+interval '31 minutes');perform public.settle_dynamo_card_checkout(op2,'cs_awardfixture2','pi_awardfixture',400,true);
 if not exists(select 1 from public.dynamo_award_items where order_id=op2) or (select payment_pending from public.dynamo_award_orders where id=op2) then raise exception 'Paid award not ready';end if;
end $test$;rollback;
