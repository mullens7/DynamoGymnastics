begin;
alter table public.dynamo_card_refunds add column external_provider_id text;
create unique index dynamo_external_refund_part on public.dynamo_card_refunds(external_provider_id,transaction_id) where external_provider_id is not null;
create function public.record_dynamo_external_refund(p_payment text,p_provider text,p_amount bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare tx record;held bigint;remaining bigint:=p_amount;portion bigint;op uuid;begin
 perform pg_advisory_xact_lock(719442005);
 if exists(select 1 from public.dynamo_card_refunds where provider_id=p_provider or external_provider_id=p_provider) then return jsonb_build_object('unchanged',true);end if;
 if p_provider !~ '^re_[a-zA-Z0-9]+$' or p_amount<=0 then raise exception 'PAYMENT_MISMATCH';end if;
 for tx in select * from public.dynamo_transactions where provider_reference=p_payment and payment_method='card' and card_checkout_id is not null order by created_at,id for update loop
 select coalesce(sum(amount_pence),0) into held from public.dynamo_card_refunds where transaction_id=tx.id and state in ('creating','pending','review');
 portion:=least(remaining,tx.amount_pence-tx.refunded_pence-held);if portion<=0 then continue;end if;op:=gen_random_uuid();
 insert into public.dynamo_card_refunds(id,transaction_id,actor_id,amount_pence,reason,external_provider_id) values(op,tx.id,tx.account_id,portion,'Refund recorded from Stripe Dashboard',p_provider);
 perform public.settle_dynamo_card_refund(op,p_provider||replace(tx.id::text,'-',''),'succeeded');remaining:=remaining-portion;if remaining=0 then exit;end if;
 end loop;
 if remaining<>0 then raise exception 'REFUND_RECONCILIATION_REQUIRED';end if;return jsonb_build_object('ok',true);
end $$;
revoke all on function public.record_dynamo_external_refund(text,text,bigint) from public,anon,authenticated;
grant execute on function public.record_dynamo_external_refund(text,text,bigint) to service_role;
-- Reuse the existing private schedule credential. This dispatcher performs no
-- membership sync; it asks the authenticated endpoint to reconcile payments.
create function public.dispatch_dynamo_payment_reconciliation() returns bigint language plpgsql security definer set search_path='' as $$
declare token text;begin
 if not exists(select 1 from public.dynamo_card_checkouts where state in ('creating','open')) and not exists(select 1 from public.dynamo_card_refunds where state in ('creating','pending')) and not exists(select 1 from public.dynamo_stripe_events where status='received') then return null;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='dynamo_sync_schedule_secret';if token is null then raise exception 'SCHEDULE_NOT_CONFIGURED';end if;
 return net.http_post(url:='https://dynamogymnastics.co.uk/api/scheduled-sync/',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{"paymentReconcile":true}'::jsonb,timeout_milliseconds:=150000);
end $$;
revoke all on function public.dispatch_dynamo_payment_reconciliation() from public,anon,authenticated;
select cron.schedule('dynamo-stripe-reconciliation','*/5 * * * *','select public.dispatch_dynamo_payment_reconciliation();');
commit;
