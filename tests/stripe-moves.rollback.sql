begin;set local role service_role;
do $test$
declare actor uuid:=gen_random_uuid();owner uuid:=gen_random_uuid();gym uuid:=gen_random_uuid();src uuid:=gen_random_uuid();dst uuid:=gen_random_uuid();op uuid:=gen_random_uuid();move uuid:=gen_random_uuid();b uuid;r jsonb;tx uuid;refund uuid;begin
 insert into public.dynamo_accounts(id,email,wallet_pence) values(actor,'cardmove-actor-'||actor||'@example.invalid',0),(owner,'cardmove-owner-'||owner||'@example.invalid',0);
 insert into public.dynamo_staff_profiles(account_id,manual_staff,role,roles) values(actor,true,'super_admin','{super_admin}');
 insert into public.dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,medical_details) values(gym,owner,'manual:'||gym,'Card','Move','2020-01-01','None');
 insert into public.dynamo_events(id,details) select id,jsonb_build_object('name',name,'date','2030-01-01','time','10:00','capacity',3,'status','Published','audience','everyone','memberPriceCents',price,'nonMemberPriceCents',price) from(values(src,'Original',1000),(dst,'Cheaper',500)) t(id,name,price);
 r:=public.prepare_dynamo_card_checkout(owner,'basket',jsonb_build_array(jsonb_build_object('kind','event','targetId',src,'gymnastId',gym,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb)),false,op,1000,'acct_fixture');b:=(r->'result'->'bookings'->0->>'bookingId')::uuid;
 perform public.attach_dynamo_card_session(op,'cs_movefixture',now()+interval '31 minutes');perform public.settle_dynamo_card_checkout(op,'cs_movefixture','pi_movefixture',1000,true);
 r:=public.quote_dynamo_event_move(actor,b,dst,null);if not(r->>'refundAvailable')::boolean then raise exception 'Card move refund unavailable';end if;
 r:=public.move_dynamo_event_booking(actor,b,dst,null,'refund',1000,500,false,'{}','[]',move);
 if (select event_id from public.dynamo_event_bookings where id=b)<>dst or (select wallet_pence from public.dynamo_accounts where id=owner)<>0 or jsonb_array_length(r->'refundRequests')<>1 then raise exception 'Card move wrong';end if;
 refund:=(r->'refundRequests'->0->>'id')::uuid;tx:=(r->'refundRequests'->0->>'transactionId')::uuid;
 if (select refunded_pence from public.dynamo_transactions where id=tx)<>0 then raise exception 'Refund prematurely completed';end if;
 perform public.move_dynamo_event_booking(actor,b,dst,null,'refund',1000,500,false,'{}','[]',move);
 if (select count(*) from public.dynamo_card_refunds where move_operation=move)<>1 then raise exception 'Duplicate move refund';end if;
 perform public.settle_dynamo_card_refund(refund,'re_movefixture','succeeded');if (select refunded_pence from public.dynamo_transactions where id=tx)<>500 then raise exception 'Move refund not recorded';end if;
end $test$;rollback;
