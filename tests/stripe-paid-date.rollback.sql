begin;
set local role service_role;
do $test$
declare owner uuid:=gen_random_uuid();gym uuid:=gen_random_uuid();event uuid:=gen_random_uuid();op uuid:=gen_random_uuid();items jsonb;paid_at timestamptz:=now()-interval '20 seconds';
begin
 insert into public.dynamo_accounts(id,email) values(owner,'date-fixture-'||owner||'@example.invalid');
 insert into public.dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,medical_details) values(gym,owner,'manual:'||gym,'Date','Fixture','2020-01-01','None');
 insert into public.dynamo_events(id,details) values(event,jsonb_build_object('name','Date fixture','date','2030-01-01','time','10:00','capacity',1,'status','Published','audience','everyone','memberPriceCents',500,'nonMemberPriceCents',500));
 items:=jsonb_build_array(jsonb_build_object('kind','event','targetId',event,'gymnastId',gym,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb));
 perform public.prepare_dynamo_card_checkout(owner,'basket',items,false,op,500,'acct_fixture');perform public.attach_dynamo_card_session(op,'cs_datefixture',now()+interval '31 minutes');perform public.settle_dynamo_card_checkout(op,'cs_datefixture','pi_datefixture',500,true);
 perform public.record_dynamo_payment_date(op,'pi_datefixture',paid_at);perform public.record_dynamo_payment_date(op,'pi_datefixture',paid_at);
 if (select settled_at from public.dynamo_card_checkouts where id=op)<>paid_at or (select count(*) from public.dynamo_confirmation_jobs where id=op)<>1 then raise exception 'Date or idempotency incorrect';end if;
 begin perform public.record_dynamo_payment_date(op,'pi_wrong',paid_at);raise exception 'Wrong payment accepted';exception when raise_exception then if sqlerrm<>'PAYMENT_MISMATCH' then raise;end if;end;
 begin perform public.record_dynamo_payment_date(op,'pi_datefixture','2020-01-01');raise exception 'Impossible date accepted';exception when raise_exception then if sqlerrm<>'PAYMENT_MISMATCH' then raise;end if;end;
 if has_function_privilege('anon','public.record_dynamo_payment_date(uuid,text,timestamptz)','execute') or has_function_privilege('authenticated','public.record_dynamo_payment_date(uuid,text,timestamptz)','execute') then raise exception 'Public date mutation exposed';end if;
end $test$;
rollback;
