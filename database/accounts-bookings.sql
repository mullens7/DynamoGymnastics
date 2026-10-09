-- Private server-side OTP sessions, wallet ledger and booking operations.
create table public.dynamo_login_codes(id uuid primary key,email text not null,ip_hash text not null,code_hash text not null,attempts integer not null default 0,consumed boolean not null default false,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '10 minutes');
create index dynamo_login_codes_email_time on public.dynamo_login_codes(email,created_at);
create index dynamo_login_codes_ip_time on public.dynamo_login_codes(ip_hash,created_at);
create table public.dynamo_user_sessions(token_hash text primary key,account_id uuid not null references public.dynamo_accounts(id),created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '12 hours');
create index dynamo_user_sessions_account on public.dynamo_user_sessions(account_id);
alter table public.dynamo_accounts add column wallet_pence bigint not null default 0 check(wallet_pence>=0);
alter table public.dynamo_transactions add column payment_method text not null default 'external' check(payment_method in ('wallet','card','external'));
alter table public.dynamo_transactions add column refunded_pence bigint not null default 0 check(refunded_pence>=0 and refunded_pence<=amount_pence);
alter table public.dynamo_transactions add column provider_reference text;
alter table public.dynamo_event_bookings add column purchase_id uuid references public.dynamo_purchases(id);
alter table public.dynamo_event_bookings add column price_pence bigint not null default 0 check(price_pence>=0);
create table public.dynamo_party_bookings(id uuid primary key default gen_random_uuid(),party_id uuid not null references public.dynamo_parties(id),account_id uuid not null references public.dynamo_accounts(id),gymnast_id uuid references public.dynamo_gymnasts(id),purchase_id uuid references public.dynamo_purchases(id),price_pence bigint not null check(price_pence>=0),status text not null default 'Booked' check(status in ('Booked','Cancelled')),created_at timestamptz not null default now());
create index dynamo_party_bookings_account on public.dynamo_party_bookings(account_id);
create index dynamo_party_bookings_party on public.dynamo_party_bookings(party_id);
create index dynamo_party_bookings_purchase on public.dynamo_party_bookings(purchase_id);
create index dynamo_event_bookings_purchase on public.dynamo_event_bookings(purchase_id);
create table public.dynamo_wallet_ledger(id uuid primary key default gen_random_uuid(),operation_id uuid not null unique,account_id uuid not null references public.dynamo_accounts(id),actor_id uuid references public.dynamo_accounts(id),amount_pence bigint not null check(amount_pence<>0),balance_pence bigint not null check(balance_pence>=0),reason text not null,purchase_id uuid references public.dynamo_purchases(id),created_at timestamptz not null default now());
create index dynamo_wallet_ledger_account on public.dynamo_wallet_ledger(account_id);
create table public.dynamo_booking_actions(id uuid primary key,booking_id uuid not null,kind text not null,action text not null,actor_id uuid references public.dynamo_accounts(id),details jsonb not null default '{}',created_at timestamptz not null default now());
create index dynamo_booking_actions_booking on public.dynamo_booking_actions(booking_id);
create table public.dynamo_refunds(id uuid primary key,transaction_id uuid not null references public.dynamo_transactions(id),actor_id uuid not null references public.dynamo_accounts(id),amount_pence bigint not null check(amount_pence>0),reason text not null,created_at timestamptz not null default now());
create index dynamo_refunds_transaction on public.dynamo_refunds(transaction_id);
create index dynamo_wallet_ledger_purchase on public.dynamo_wallet_ledger(purchase_id);
create index dynamo_wallet_ledger_actor on public.dynamo_wallet_ledger(actor_id);
create index dynamo_booking_actions_actor on public.dynamo_booking_actions(actor_id);
create index dynamo_refunds_actor on public.dynamo_refunds(actor_id);
create index dynamo_party_bookings_gymnast on public.dynamo_party_bookings(gymnast_id);
alter table public.dynamo_login_codes enable row level security;
alter table public.dynamo_user_sessions enable row level security;
alter table public.dynamo_party_bookings enable row level security;
alter table public.dynamo_wallet_ledger enable row level security;
alter table public.dynamo_booking_actions enable row level security;
alter table public.dynamo_refunds enable row level security;
revoke all on public.dynamo_login_codes,public.dynamo_user_sessions,public.dynamo_party_bookings,public.dynamo_wallet_ledger,public.dynamo_booking_actions,public.dynamo_refunds from anon,authenticated;
grant select,insert,update,delete on public.dynamo_login_codes,public.dynamo_user_sessions to service_role;
grant select,insert,update on public.dynamo_party_bookings,public.dynamo_wallet_ledger,public.dynamo_booking_actions,public.dynamo_refunds,public.dynamo_event_bookings,public.dynamo_purchases,public.dynamo_transactions to service_role;
create or replace function public.request_dynamo_code(p_id uuid,p_email text,p_ip text,p_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(719442003);
 if p_email<>lower(btrim(p_email)) or length(p_email)>254 or p_hash!~'^[a-f0-9]{64}$' or p_ip!~'^[a-f0-9]{64}$' then raise exception 'INVALID_LOGIN';end if;
 if exists(select 1 from public.dynamo_login_codes where email=p_email and created_at>now()-interval '60 seconds') or (select count(*) from public.dynamo_login_codes where email=p_email and created_at>now()-interval '1 hour')>=5 or (select count(*) from public.dynamo_login_codes where ip_hash=p_ip and created_at>now()-interval '1 hour')>=20 then return jsonb_build_object('ok',false,'error','LOGIN_RATE_LIMIT');end if;
 update public.dynamo_login_codes set consumed=true where email=p_email and not consumed;
 insert into public.dynamo_login_codes(id,email,ip_hash,code_hash) values(p_id,p_email,p_ip,p_hash);
 return jsonb_build_object('ok',true);
end;$$;
create or replace function public.verify_dynamo_code(p_id uuid,p_hash text,p_session_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare code public.dynamo_login_codes%rowtype;account_uuid uuid;
begin
 select * into code from public.dynamo_login_codes where id=p_id for update;
 if not found or code.consumed or code.expires_at<=now() or code.attempts>=5 then return jsonb_build_object('ok',false,'error','OTP_EXPIRED');end if;
 if code.code_hash<>p_hash then update public.dynamo_login_codes set attempts=attempts+1,consumed=attempts+1>=5 where id=p_id;return jsonb_build_object('ok',false,'error','OTP_INCORRECT');end if;
 if p_session_hash!~'^[a-f0-9]{64}$' then raise exception 'INVALID_LOGIN';end if;
 update public.dynamo_login_codes set consumed=true where id=p_id;
 insert into public.dynamo_accounts(email) values(code.email) on conflict(email) do update set email=excluded.email returning id into account_uuid;
 insert into public.dynamo_user_sessions(token_hash,account_id) values(p_session_hash,account_uuid);
 return jsonb_build_object('ok',true,'accountId',account_uuid,'email',code.email);
end;$$;
create or replace function public.adjust_dynamo_wallet(p_account uuid,p_actor uuid,p_amount bigint,p_reason text,p_operation uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare balance bigint;prior public.dynamo_wallet_ledger%rowtype;
begin
 select wallet_pence into balance from public.dynamo_accounts where id=p_account for update;if not found then raise exception 'ACCOUNT_NOT_FOUND';end if;
 select * into prior from public.dynamo_wallet_ledger where operation_id=p_operation;if found then if prior.account_id<>p_account or prior.amount_pence<>p_amount then raise exception 'OPERATION_CONFLICT';end if;return jsonb_build_object('balance',balance,'unchanged',true);end if;
 if p_amount=0 or abs(p_amount)>1000000 or length(btrim(p_reason))<3 or length(p_reason)>300 then raise exception 'INVALID_WALLET_CHANGE';end if;
 if balance+p_amount<0 then raise exception 'INSUFFICIENT_CREDIT';end if;
 balance:=balance+p_amount;update public.dynamo_accounts set wallet_pence=balance where id=p_account;
 insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason) values(p_operation,p_account,p_actor,p_amount,balance,p_reason);
 return jsonb_build_object('balance',balance);
end;$$;
create or replace function public.book_dynamo_session(p_kind text,p_target uuid,p_account uuid,p_gymnast uuid,p_credit boolean,p_operation uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare account public.dynamo_accounts%rowtype;gym public.dynamo_gymnasts%rowtype;info jsonb;price bigint;purchase uuid;booking uuid;capacity integer;count_booked integer;prior public.dynamo_booking_actions%rowtype;
begin
 perform pg_advisory_xact_lock(719442004);
 select * into prior from public.dynamo_booking_actions where id=p_operation;if found then if prior.actor_id<>p_account or prior.kind<>p_kind or prior.details->>'target'<>p_target::text or prior.details->>'gymnast'<>p_gymnast::text then raise exception 'OPERATION_CONFLICT';end if;return jsonb_build_object('bookingId',prior.booking_id,'unchanged',true);end if;
 select * into account from public.dynamo_accounts where id=p_account for update;if not found then raise exception 'ACCOUNT_NOT_FOUND';end if;
 select * into gym from public.dynamo_gymnasts where id=p_gymnast and account_id=p_account;if not found then raise exception 'GYMNAST_NOT_FOUND';end if;
 if p_kind='event' then select details into info from public.dynamo_events where id=p_target and not archived for update;if not found or info->>'status'<>'Published' then raise exception 'SESSION_UNAVAILABLE';end if;
  capacity:=(info->>'capacity')::integer;select count(*) into count_booked from public.dynamo_event_bookings where event_id=p_target and status='Booked';
  if info->>'audience'<>'everyone' and (gym.id is null or not gym.active or cardinality(gym.groups)=0 or (info->>'audience'='groups' and not exists(select 1 from jsonb_array_elements_text(info->'allowedGroups') g where g=any(gym.groups)))) then raise exception 'SESSION_INELIGIBLE';end if;
 elsif p_kind='party' then select details into info from public.dynamo_parties where id=p_target and not archived for update;if not found or info->>'status'='Cancelled' then raise exception 'SESSION_UNAVAILABLE';end if;
  capacity:=1;select count(*) into count_booked from public.dynamo_party_bookings where party_id=p_target and status='Booked';
 else raise exception 'INVALID_BOOKING';end if;
 if ((info->>'date')||' '||(info->>'time'))::timestamp at time zone 'Europe/London'<=now() or capacity is null or count_booked>=capacity then raise exception 'SESSION_FULL';end if;
 if p_kind='event' and exists(select 1 from public.dynamo_event_bookings where event_id=p_target and gymnast_id=p_gymnast and status='Booked') then raise exception 'ALREADY_BOOKED';end if;
 price:=(info->>(case when account.roster_member then 'memberPriceCents' else 'nonMemberPriceCents' end))::bigint;
 if price is null or price<0 then raise exception 'PRICE_NOT_CONFIGURED';end if;
 if price>0 and (not p_credit or account.wallet_pence<price) then raise exception 'CARD_PAYMENT_NOT_CONNECTED';end if;
 insert into public.dynamo_purchases(account_id,details) values(p_account,jsonb_build_object('name',info->>'name','kind',p_kind,'targetId',p_target,'originalDate',info->>'date','originalTime',info->>'time','pricePence',price)) returning id into purchase;
 if price>0 then update public.dynamo_accounts set wallet_pence=wallet_pence-price where id=p_account;
 insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason,purchase_id) values(p_operation,p_account,p_account,-price,account.wallet_pence-price,'Booking payment',purchase);end if;
 insert into public.dynamo_transactions(account_id,purchase_id,amount_pence,status,payment_method) values(p_account,purchase,price,'successful','wallet');
 if p_kind='event' then insert into public.dynamo_event_bookings(event_id,account_id,gymnast_id,purchase_id,price_pence) values(p_target,p_account,p_gymnast,purchase,price) returning id into booking;
 else insert into public.dynamo_party_bookings(party_id,account_id,gymnast_id,purchase_id,price_pence) values(p_target,p_account,p_gymnast,purchase,price) returning id into booking;end if;
 insert into public.dynamo_booking_actions(id,booking_id,kind,action,actor_id,details) values(p_operation,booking,p_kind,'created',p_account,jsonb_build_object('target',p_target,'gymnast',p_gymnast));
 return jsonb_build_object('bookingId',booking,'pricePence',price,'walletBalance',account.wallet_pence-price);
end;$$;
create or replace function public.manage_dynamo_booking(p_kind text,p_booking uuid,p_actor uuid,p_action text,p_target uuid,p_date text,p_time text,p_operation uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare account_uuid uuid;gym_uuid uuid;old_target uuid;info jsonb;old_info jsonb;gym public.dynamo_gymnasts%rowtype;current_status text;prior public.dynamo_booking_actions%rowtype;
begin
 perform pg_advisory_xact_lock(719442004);
 select * into prior from public.dynamo_booking_actions where id=p_operation;if found then if prior.booking_id<>p_booking or prior.action<>p_action or prior.kind<>p_kind or prior.actor_id<>p_actor then raise exception 'OPERATION_CONFLICT';end if;return jsonb_build_object('ok',true,'unchanged',true);end if;
 if p_kind='event' then select account_id,gymnast_id,event_id,status into account_uuid,gym_uuid,old_target,current_status from public.dynamo_event_bookings where id=p_booking for update;
 elsif p_kind='party' then select account_id,gymnast_id,party_id,status into account_uuid,gym_uuid,old_target,current_status from public.dynamo_party_bookings where id=p_booking for update;
 else raise exception 'INVALID_BOOKING';end if;
 if account_uuid is null then raise exception 'BOOKING_NOT_FOUND';end if;
 if p_action='cancel' then
  if p_kind='event' then update public.dynamo_event_bookings set status='Cancelled' where id=p_booking;else update public.dynamo_party_bookings set status='Cancelled' where id=p_booking;end if;
 elsif p_action='move' then
  if current_status<>'Booked' then raise exception 'BOOKING_CANCELLED';end if;
  if p_kind='event' then
   if p_target=old_target then raise exception 'SAME_SESSION';end if;
   select details into info from public.dynamo_events where id=p_target and not archived for update;if not found or info->>'status'<>'Published' or ((info->>'date')||' '||(info->>'time'))::timestamp at time zone 'Europe/London'<=now() then raise exception 'SESSION_UNAVAILABLE';end if;
   if (select count(*) from public.dynamo_event_bookings where event_id=p_target and status='Booked')>=(info->>'capacity')::integer then raise exception 'SESSION_FULL';end if;
   select * into gym from public.dynamo_gymnasts where id=gym_uuid and account_id=account_uuid;
   if info->>'audience'<>'everyone' and (gym.id is null or not gym.active or cardinality(gym.groups)=0 or (info->>'audience'='groups' and not exists(select 1 from jsonb_array_elements_text(info->'allowedGroups') g where g=any(gym.groups)))) then raise exception 'SESSION_INELIGIBLE';end if;
   update public.dynamo_event_bookings set event_id=p_target where id=p_booking;
  else
   if p_date!~'^\d{4}-\d{2}-\d{2}$' or p_time!~'^([01]\d|2[0-3]):[0-5]\d$' or p_date::date<current_date then raise exception 'INVALID_DATE';end if;
   select details into old_info from public.dynamo_parties where id=old_target for update;
   if exists(select 1 from public.dynamo_parties p where p.id<>old_target and not p.archived and p.details->>'status'<>'Cancelled' and p.details->>'room'=old_info->>'room' and p.details->>'date'=p_date and abs(extract(epoch from ((p.details->>'time')::time-p_time::time)))<5400) then raise exception 'PARTY_SLOT_TAKEN';end if;
   update public.dynamo_parties set details=details||jsonb_build_object('date',p_date,'time',p_time) where id=old_target;
   info:=jsonb_build_object('date',p_date,'time',p_time);
  end if;
 else raise exception 'INVALID_BOOKING_ACTION';end if;
 insert into public.dynamo_booking_actions(id,booking_id,kind,action,actor_id,details) values(p_operation,p_booking,p_kind,p_action,p_actor,jsonb_build_object('fromTarget',old_target,'toTarget',p_target,'destination',info,'previous',old_info));
 return jsonb_build_object('ok',true);
end;$$;
create or replace function public.refund_dynamo_wallet_payment(p_transaction uuid,p_actor uuid,p_amount bigint,p_reason text,p_operation uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare tx public.dynamo_transactions%rowtype;balance bigint;prior public.dynamo_refunds%rowtype;
begin
 perform pg_advisory_xact_lock(719442005);
 select * into prior from public.dynamo_refunds where id=p_operation;if found then if prior.transaction_id<>p_transaction or prior.amount_pence<>p_amount or prior.actor_id<>p_actor then raise exception 'OPERATION_CONFLICT';end if;return jsonb_build_object('ok',true,'unchanged',true);end if;
 select * into tx from public.dynamo_transactions where id=p_transaction for update;if not found then raise exception 'PAYMENT_NOT_FOUND';end if;
 if tx.payment_method<>'wallet' then raise exception 'CARD_REFUNDS_NOT_CONNECTED';end if;
 if tx.status<>'successful' or p_amount<=0 or p_amount>tx.amount_pence-tx.refunded_pence or length(btrim(p_reason))<3 or length(p_reason)>300 then raise exception 'INVALID_REFUND';end if;
 select wallet_pence into balance from public.dynamo_accounts where id=tx.account_id for update;balance:=balance+p_amount;
 update public.dynamo_accounts set wallet_pence=balance where id=tx.account_id;
 update public.dynamo_transactions set refunded_pence=refunded_pence+p_amount,status=case when refunded_pence+p_amount=amount_pence then 'refunded' else status end where id=p_transaction;
 insert into public.dynamo_refunds(id,transaction_id,actor_id,amount_pence,reason) values(p_operation,p_transaction,p_actor,p_amount,p_reason);
 insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason,purchase_id) values(p_operation,tx.account_id,p_actor,p_amount,balance,'Refund: '||p_reason,tx.purchase_id);
 return jsonb_build_object('ok',true,'refundedPence',tx.refunded_pence+p_amount,'balance',balance);
end;$$;
revoke all on function public.request_dynamo_code(uuid,text,text,text),public.verify_dynamo_code(uuid,text,text),public.adjust_dynamo_wallet(uuid,uuid,bigint,text,uuid),public.book_dynamo_session(text,uuid,uuid,uuid,boolean,uuid),public.manage_dynamo_booking(text,uuid,uuid,text,uuid,text,text,uuid),public.refund_dynamo_wallet_payment(uuid,uuid,bigint,text,uuid) from public,anon,authenticated;
grant execute on function public.request_dynamo_code(uuid,text,text,text),public.verify_dynamo_code(uuid,text,text),public.adjust_dynamo_wallet(uuid,uuid,bigint,text,uuid),public.book_dynamo_session(text,uuid,uuid,uuid,boolean,uuid),public.manage_dynamo_booking(text,uuid,uuid,text,uuid,text,text,uuid),public.refund_dynamo_wallet_payment(uuid,uuid,bigint,text,uuid) to service_role;
