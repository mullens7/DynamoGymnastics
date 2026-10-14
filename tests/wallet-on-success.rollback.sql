begin;set local role service_role;
do $test$
declare owner uuid:=gen_random_uuid();gym uuid:=gen_random_uuid();event uuid:=gen_random_uuid();op uuid:=gen_random_uuid();items jsonb;result jsonb;begin
insert into public.dynamo_accounts(id,email,owner_name,wallet_pence) values(owner,'wallet-success-fixture-'||owner||'@example.invalid','Wallet Fixture',1200);
insert into public.dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,medical_details) values(gym,owner,'manual:'||gym,'Wallet','Fixture','2020-01-01','None');
insert into public.dynamo_events(id,details) values(event,jsonb_build_object('name','Wallet-only fixture','date','2030-01-01','time','10:00','capacity',2,'status','Published','audience','everyone','memberPriceCents',1000,'nonMemberPriceCents',1000));
items:=jsonb_build_array(jsonb_build_object('kind','event','targetId',event,'gymnastId',gym,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb));
result:=public.prepare_dynamo_card_checkout(owner,'basket',items,true,op,1000,'acct_fixture');
if result->>'state'<>'paid' or not (result->>'wallet_debited')::boolean or (select wallet_pence from public.dynamo_accounts where id=owner)<>200 then raise exception 'Wallet-only success not deducted';end if;
perform public.prepare_dynamo_card_checkout(owner,'basket',items,true,op,1000,'acct_fixture');
if (select count(*) from public.dynamo_wallet_ledger where account_id=owner)<>1 or (select sum(amount_pence) from public.dynamo_wallet_ledger where account_id=owner)<>-1000 then raise exception 'Duplicate wallet payment';end if;
if exists(select 1 from public.dynamo_wallet_ledger where account_id=owner and reason<>'Booking payment') then raise exception 'Temporary wallet history shown';end if;
end $test$;
rollback;