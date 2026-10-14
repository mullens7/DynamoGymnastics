begin;
create table public.dynamo_card_checkouts (
 id uuid primary key, account_id uuid not null references public.dynamo_accounts(id), kind text not null check(kind in ('basket','awards')), items jsonb not null, credit boolean not null, total_pence bigint not null check(total_pence>=0), wallet_pence bigint not null default 0, card_pence bigint not null default 0, credit_left bigint not null default 0,
 state text not null default 'creating' check(state in ('creating','open','paid','expired','review')), session_id text unique, payment_intent text, connected_account text not null, return_origin text not null default 'https://dynamo-gymnastics.vercel.app', result jsonb not null default '{}', created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '31 minutes', settled_at timestamptz
);
alter table public.dynamo_event_bookings add column payment_pending boolean not null default false;
alter table public.dynamo_party_bookings add column payment_pending boolean not null default false;
alter table public.dynamo_award_orders add column payment_pending boolean not null default false;
alter table public.dynamo_transactions add column card_checkout_id uuid references public.dynamo_card_checkouts(id);
create table public.dynamo_card_refunds(id uuid primary key, transaction_id uuid not null references public.dynamo_transactions(id), actor_id uuid not null references public.dynamo_accounts(id), amount_pence bigint not null check(amount_pence>0), reason text not null, provider_id text unique, state text not null default 'creating' check(state in ('creating','pending','succeeded','failed','canceled','review')), created_at timestamptz not null default now());
create index dynamo_card_checkouts_open on public.dynamo_card_checkouts(created_at) where state in ('creating','open');
alter table public.dynamo_card_checkouts enable row level security;alter table public.dynamo_card_refunds enable row level security;
revoke all on public.dynamo_card_checkouts,public.dynamo_card_refunds from public,anon,authenticated;
grant select,insert,update on public.dynamo_card_checkouts,public.dynamo_card_refunds to service_role;
grant update on public.dynamo_award_orders to service_role;
-- Reuse all existing validation and booking snapshots inside one transaction. The
-- temporary balance is never visible outside that transaction; real debits below
-- replace the validation functions' provisional wallet ledger entries.
create function public.prepare_dynamo_card_checkout(p_account uuid,p_kind text,p_items jsonb,p_credit boolean,p_operation uuid,p_expected_total bigint,p_connected text,p_origin text default 'https://dynamo-gymnastics.vercel.app') returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.dynamo_card_checkouts%rowtype; balance bigint; used bigint; remaining bigint; v_result jsonb; ids uuid[]; rec record; portion bigint; running bigint;
begin
 perform pg_advisory_xact_lock(719442001);perform pg_advisory_xact_lock(719442004);
 select * into previous from public.dynamo_card_checkouts where id=p_operation for update;
 if found then if previous.account_id<>p_account or previous.kind<>p_kind or previous.items<>p_items or previous.credit<>p_credit or previous.total_pence<>p_expected_total or previous.connected_account<>p_connected then raise exception 'OPERATION_CONFLICT';end if;return to_jsonb(previous);end if;
 if p_origin not in ('https://dynamo-gymnastics.vercel.app','https://dynamogymnastics.co.uk','https://www.dynamogymnastics.co.uk','https://auth.dynamogymnastics.co.uk','https://manage.dynamogymnastics.co.uk') then raise exception 'INVALID_HOST';end if;
 if p_kind not in ('basket','awards') or p_expected_total is null or p_expected_total<0 or p_expected_total>10000000 or p_connected !~ '^acct_[a-zA-Z0-9]+$' then raise exception 'INVALID_BOOKING';end if;
 if exists(select 1 from public.dynamo_card_checkouts where account_id=p_account and state in ('creating','open','review')) then raise exception 'CHECKOUT_IN_PROGRESS';end if;
 if exists(select 1 from public.dynamo_basket_checkouts where id=p_operation) or exists(select 1 from public.dynamo_award_orders where id=p_operation) then raise exception 'OPERATION_CONFLICT';end if;
 select wallet_pence into balance from public.dynamo_accounts where id=p_account for update;if not found then raise exception 'ACCOUNT_NOT_FOUND';end if;
 used:=case when p_credit then least(balance,p_expected_total) else 0 end;
 if p_expected_total-used between 1 and 29 then used:=greatest(0,p_expected_total-30);end if;
 if p_expected_total-used between 1 and 29 then raise exception 'CARD_AMOUNT_TOO_SMALL';end if;
 insert into public.dynamo_card_checkouts(id,account_id,kind,items,credit,total_pence,wallet_pence,card_pence,credit_left,connected_account,return_origin) values(p_operation,p_account,p_kind,p_items,p_credit,p_expected_total,used,p_expected_total-used,used,p_connected,p_origin);
 update public.dynamo_accounts set wallet_pence=p_expected_total where id=p_account;
 if p_kind='basket' then v_result:=public.checkout_dynamo_basket(p_account,p_items,true,p_operation,p_expected_total);
 select array_agg(purchase_id) into ids from (select purchase_id from public.dynamo_event_bookings where id in(select (v->>'bookingId')::uuid from jsonb_array_elements(v_result->'bookings') v) union all select purchase_id from public.dynamo_party_bookings where id in(select (v->>'bookingId')::uuid from jsonb_array_elements(v_result->'bookings') v)) purchases;
 else v_result:=public.checkout_dynamo_awards(p_account,p_items,p_operation,p_expected_total,true);ids:=array[(v_result->>'purchaseId')::uuid];end if;
 delete from public.dynamo_wallet_ledger where purchase_id=any(ids) and account_id=p_account and amount_pence<0;
 update public.dynamo_accounts set wallet_pence=balance-used where id=p_account;remaining:=used;running:=balance;
 for rec in select * from public.dynamo_transactions where purchase_id=any(ids) order by created_at,id for update loop
 portion:=least(remaining,rec.amount_pence);remaining:=remaining-portion;running:=running-portion;
 if portion>0 then
 insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason,purchase_id) values(gen_random_uuid(),p_account,p_account,-portion,running,'Checkout wallet reservation',rec.purchase_id);
 end if;
 if rec.amount_pence-portion>0 then
 update public.dynamo_transactions set amount_pence=rec.amount_pence-portion,payment_method='card',status='pending',card_checkout_id=p_operation where id=rec.id;
 if portion>0 then insert into public.dynamo_transactions(account_id,purchase_id,amount_pence,status,payment_method,card_checkout_id) values(p_account,rec.purchase_id,portion,'pending','wallet',p_operation);end if;
 else update public.dynamo_transactions set payment_method='wallet',status=case when p_expected_total-used=0 then 'successful' else 'pending' end,card_checkout_id=p_operation where id=rec.id;end if;
 end loop;
 update public.dynamo_purchases set details=details||jsonb_build_object('paymentStatus',case when p_expected_total-used=0 then 'paid' else 'pending' end,'checkoutId',p_operation) where id=any(ids);
 update public.dynamo_event_bookings set payment_pending=p_expected_total-used>0 where purchase_id=any(ids);
 update public.dynamo_party_bookings set payment_pending=p_expected_total-used>0 where purchase_id=any(ids);
 update public.dynamo_award_orders set payment_pending=p_expected_total-used>0 where id=p_operation;
 if p_expected_total-used>0 then delete from public.dynamo_confirmation_jobs where id=p_operation;delete from public.dynamo_party_alerts where booking_id in(select id from public.dynamo_party_bookings where purchase_id=any(ids));end if;
 v_result:=v_result||jsonb_build_object('walletBalance',balance-used,'totalPence',p_expected_total);
 update public.dynamo_card_checkouts set result=v_result,state=case when p_expected_total-used=0 then 'paid' else 'creating' end,settled_at=case when p_expected_total-used=0 then now() else null end where id=p_operation;
 select * into previous from public.dynamo_card_checkouts where id=p_operation;return to_jsonb(previous);
end $$;
create function public.attach_dynamo_card_session(p_order uuid,p_session text,p_expires timestamptz) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.dynamo_card_checkouts%rowtype;begin
 select * into r from public.dynamo_card_checkouts where id=p_order for update;if not found then raise exception 'CHECKOUT_NOT_FOUND';end if;
 if r.session_id is not null and r.session_id<>p_session then raise exception 'OPERATION_CONFLICT';end if;
 if p_session !~ '^cs_[a-zA-Z0-9_]+$' then raise exception 'INVALID_SESSION';end if;
 update public.dynamo_card_checkouts set session_id=p_session,expires_at=p_expires,state=case when state='creating' then 'open' else state end where id=p_order;return jsonb_build_object('ok',true);
end $$;
create function public.settle_dynamo_card_checkout(p_order uuid,p_session text,p_payment text,p_amount bigint,p_paid boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.dynamo_card_checkouts%rowtype; ids uuid[]; balance bigint;begin
 perform pg_advisory_xact_lock(719442001);perform pg_advisory_xact_lock(719442004);
 select * into r from public.dynamo_card_checkouts where id=p_order for update;if not found then raise exception 'CHECKOUT_NOT_FOUND';end if;
 if r.session_id is distinct from p_session or r.card_pence<>p_amount or p_paid and coalesce(p_payment,'') !~ '^pi_[a-zA-Z0-9]+$' then raise exception 'PAYMENT_MISMATCH';end if;
 if r.state in ('paid','expired') then return jsonb_build_object('state',r.state,'unchanged',true,'accountId',r.account_id,'result',r.result);end if;
 select array_agg(distinct purchase_id) into ids from public.dynamo_transactions where card_checkout_id=p_order;
 if p_paid then
 update public.dynamo_transactions set status='successful',provider_reference=case when payment_method='card' then p_payment else provider_reference end where card_checkout_id=p_order;
 update public.dynamo_event_bookings set payment_pending=false where purchase_id=any(ids);
 update public.dynamo_party_bookings set payment_pending=false where purchase_id=any(ids);
 update public.dynamo_award_orders set payment_pending=false where id=p_order;
 if r.kind='basket' then
 insert into public.dynamo_confirmation_jobs(id,account_id,booking_ids) values(p_order,r.account_id,array(select (v->>'bookingId')::uuid from jsonb_array_elements(r.result->'bookings') v)) on conflict do nothing;
 insert into public.dynamo_party_alerts(booking_id) select id from public.dynamo_party_bookings where purchase_id=any(ids) on conflict do nothing;
 end if;
 else
 update public.dynamo_event_bookings set status='Cancelled',payment_pending=false where purchase_id=any(ids);
 update public.dynamo_party_bookings set status='Cancelled',payment_pending=false where purchase_id=any(ids);
 update public.dynamo_transactions set status='declined' where card_checkout_id=p_order;
 -- Only provisional award items are removed. The unsuccessful purchase remains in history.
 delete from public.dynamo_award_items where order_id=p_order;
 update public.dynamo_award_orders set payment_pending=false where id=p_order;
 if r.wallet_pence>0 then
 select wallet_pence into balance from public.dynamo_accounts where id=r.account_id for update;
 update public.dynamo_accounts set wallet_pence=wallet_pence+r.wallet_pence where id=r.account_id;
 insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason) values(p_order,r.account_id,r.account_id,r.wallet_pence,balance+r.wallet_pence,'Unpaid checkout: wallet credit released');end if;
 end if;
 update public.dynamo_purchases set details=details||jsonb_build_object('paymentStatus',case when p_paid then 'paid' else 'expired' end) where id=any(ids);
 update public.dynamo_card_checkouts set state=case when p_paid then 'paid' else 'expired' end,payment_intent=p_payment,settled_at=now() where id=p_order;
 return jsonb_build_object('state',case when p_paid then 'paid' else 'expired' end,'accountId',r.account_id,'result',r.result);
end $$;
create function public.claim_dynamo_card_refund(p_transaction uuid,p_actor uuid,p_amount bigint,p_reason text,p_operation uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare tx public.dynamo_transactions%rowtype;r public.dynamo_card_refunds%rowtype;held bigint;begin
 perform pg_advisory_xact_lock(719442005);
 select * into r from public.dynamo_card_refunds where id=p_operation for update;
 if found then if r.transaction_id<>p_transaction or r.actor_id<>p_actor or r.amount_pence<>p_amount or r.reason<>p_reason then raise exception 'OPERATION_CONFLICT';end if;return to_jsonb(r);end if;
 select * into tx from public.dynamo_transactions where id=p_transaction for update;
 if not found or tx.payment_method<>'card' or tx.card_checkout_id is null or tx.provider_reference !~ '^pi_[a-zA-Z0-9]+$' then raise exception 'PAYMENT_NOT_FOUND';end if;
 select coalesce(sum(amount_pence),0) into held from public.dynamo_card_refunds where transaction_id=p_transaction and state in ('creating','pending','review');
 if held>0 then raise exception 'REFUND_PENDING';end if;
 if tx.status<>'successful' or p_amount<=0 or p_amount>tx.amount_pence-tx.refunded_pence-held or length(trim(p_reason))<3 or length(p_reason)>300 then raise exception 'INVALID_REFUND';end if;
 insert into public.dynamo_card_refunds(id,transaction_id,actor_id,amount_pence,reason) values(p_operation,p_transaction,p_actor,p_amount,p_reason) returning * into r;return to_jsonb(r);
end $$;
create function public.settle_dynamo_card_refund(p_operation uuid,p_provider text,p_state text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.dynamo_card_refunds%rowtype;tx public.dynamo_transactions%rowtype;begin
 perform pg_advisory_xact_lock(719442005);select * into r from public.dynamo_card_refunds where id=p_operation for update;
 if not found then raise exception 'REFUND_NOT_FOUND';end if;
 if coalesce(p_provider,'') !~ '^re_[a-zA-Z0-9]+$' or r.provider_id is not null and r.provider_id<>p_provider or p_state not in ('pending','succeeded','failed','canceled') then raise exception 'PAYMENT_MISMATCH';end if;
 if r.state='succeeded' then return jsonb_build_object('ok',true,'state','succeeded','unchanged',true);end if;
 select * into tx from public.dynamo_transactions where id=r.transaction_id for update;
 if p_state='succeeded' then
 if tx.refunded_pence+r.amount_pence>tx.amount_pence then raise exception 'INVALID_REFUND';end if;
 update public.dynamo_transactions set refunded_pence=refunded_pence+r.amount_pence,status=case when refunded_pence+r.amount_pence=amount_pence then 'refunded' else status end where id=tx.id;
 insert into public.dynamo_refunds(id,transaction_id,actor_id,amount_pence,reason) values(r.id,tx.id,r.actor_id,r.amount_pence,r.reason) on conflict do nothing;
 end if;
 update public.dynamo_card_refunds set state=p_state,provider_id=p_provider where id=r.id;
 return jsonb_build_object('ok',true,'state',p_state);
end $$;
-- No ticket check-in, manual confirmation, move or cancellation can operate on an unpaid reservation.
do $$declare r record;def text;begin
 for r in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('check_in_dynamo_attendee','claim_dynamo_manual_confirmation','manage_dynamo_booking','quote_dynamo_event_move','move_dynamo_event_booking') loop
 def:=pg_get_functiondef(r.oid);def:=replace(def,E'\nbegin',E'\nbegin\n if exists(select 1 from public.dynamo_event_bookings where id=p_booking and payment_pending) or exists(select 1 from public.dynamo_party_bookings where id=p_booking and payment_pending) then raise exception ''PAYMENT_PENDING'';end if;');def:=replace(def,E'\nBEGIN',E'\nBEGIN\n IF EXISTS(SELECT 1 FROM public.dynamo_event_bookings WHERE id=p_booking AND payment_pending) THEN RAISE EXCEPTION ''PAYMENT_PENDING'';END IF;');execute def;
 end loop;
end $$;
-- Awaiting-payment rows cannot be deleted independently from their checkout.
create function public.guard_dynamo_pending_history() returns trigger language plpgsql security invoker set search_path='' as $$begin if old.payment_pending then raise exception 'PAYMENT_PENDING';end if;return old;end $$;
create trigger dynamo_pending_event_history before delete on public.dynamo_event_bookings for each row execute function public.guard_dynamo_pending_history();
create trigger dynamo_pending_party_history before delete on public.dynamo_party_bookings for each row execute function public.guard_dynamo_pending_history();
do $$declare r record;begin for r in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('prepare_dynamo_card_checkout','attach_dynamo_card_session','settle_dynamo_card_checkout','claim_dynamo_card_refund','settle_dynamo_card_refund','guard_dynamo_pending_history') loop execute format('revoke all on function %s from public,anon,authenticated',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;end $$;
commit;
