begin;
do $$declare def text;begin select pg_get_functiondef(oid) into def from pg_proc where proname='claim_dynamo_card_refund';def:=replace(def,'if tx.status<>''successful'' or p_amount<=0','if held>0 then raise exception ''REFUND_PENDING'';end if; if tx.status<>''successful'' or p_amount<=0');execute def;end $$;
-- Preserve the user's explicit permanent-history-delete facility after a settled
-- payment; never erase a refund that is still awaiting Stripe confirmation.
alter table public.dynamo_card_refunds drop constraint dynamo_card_refunds_transaction_id_fkey;
alter table public.dynamo_card_refunds add constraint dynamo_card_refunds_transaction_id_fkey foreign key(transaction_id) references public.dynamo_transactions(id) on delete cascade;
create function public.guard_dynamo_pending_transaction_history() returns trigger language plpgsql security invoker set search_path='' as $$begin if old.status='pending' or exists(select 1 from public.dynamo_card_refunds where transaction_id=old.id and state in ('creating','pending','review')) then raise exception 'PAYMENT_PENDING';end if;return old;end $$;
revoke all on function public.guard_dynamo_pending_transaction_history() from public,anon,authenticated;
grant execute on function public.guard_dynamo_pending_transaction_history() to service_role;
create trigger dynamo_pending_transaction_history before delete on public.dynamo_transactions for each row execute function public.guard_dynamo_pending_transaction_history();
commit;
