begin;
set local role service_role;
do $test$
declare account uuid:=gen_random_uuid();purchase uuid:=gen_random_uuid();award_order uuid:=gen_random_uuid();
begin
 insert into public.dynamo_accounts(id,email) values(account,'award-recovery-'||account||'@example.invalid');
 insert into public.dynamo_purchases(id,account_id,details) values(purchase,account,'{"kind":"award","name":"Recovery fixture"}');
 insert into public.dynamo_award_orders(id,account_id,purchase_id,items,result) values(award_order,account,purchase,'[]','{}');
 insert into public.dynamo_award_confirmation_jobs(id,account_id,status,attempted_at) values(award_order,account,'sending',now()-interval '11 minutes');
 perform public.recover_dynamo_email_status();
 if (select status from public.dynamo_award_confirmation_jobs where id=award_order)<>'review' then raise exception 'Interrupted award email not flagged';end if;
 update public.dynamo_award_confirmation_jobs set status='sent' where id=award_order;
 perform public.recover_dynamo_email_status();
 if (select status from public.dynamo_award_confirmation_jobs where id=award_order)<>'sent' then raise exception 'Sent award email changed';end if;
end $test$;
rollback;
