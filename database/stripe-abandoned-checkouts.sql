begin;
alter table public.dynamo_transactions add column if not exists payment_attempt_failed boolean not null default false;
update public.dynamo_transactions t set payment_attempt_failed=true where t.payment_method='card' and t.card_checkout_id is not null and exists(select 1 from public.dynamo_stripe_events e where e.payload->>'type'='payment_intent.payment_failed' and e.payload#>>'{data,object,metadata,site}'='dynamo-gymnastics' and e.payload#>>'{data,object,metadata,orderId}'=t.card_checkout_id::text);
update public.dynamo_transactions set status='pending' where card_checkout_id is not null and status='declined' and not payment_attempt_failed;
do $patch$
declare definition text;
begin
select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='settle_dynamo_card_checkout';
if definition is null or position('update public.dynamo_transactions set status=''declined'' where card_checkout_id=p_order;' in definition)=0 then raise exception 'Unexpected checkout settlement function';end if;
definition:=replace(definition,'update public.dynamo_transactions set status=''declined'' where card_checkout_id=p_order;','update public.dynamo_transactions set status=case when payment_attempt_failed then ''declined'' else ''pending'' end where card_checkout_id=p_order;');
execute definition;
end $patch$;
commit;