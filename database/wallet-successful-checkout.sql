begin;
select pg_advisory_xact_lock(719442001);
select pg_advisory_xact_lock(719442004);
alter table public.dynamo_card_checkouts add column wallet_debited boolean not null default true;
alter table public.dynamo_card_checkouts alter column wallet_debited set default false;
create temporary table wallet_display_accounts on commit drop as select distinct account_id from public.dynamo_wallet_ledger where reason in ('Checkout wallet reservation','Unpaid checkout: wallet credit released');
-- Restore only deductions still held for unpaid checkouts; completed purchases stay deducted.
update public.dynamo_accounts a set wallet_pence=a.wallet_pence+x.held from (select account_id,sum(wallet_pence) held from public.dynamo_card_checkouts where state in ('creating','open','review') and wallet_debited group by account_id) x where a.id=x.account_id;
update public.dynamo_card_checkouts set wallet_debited=false where state in ('creating','open','review');
-- Completed legacy deductions remain genuine booking history.
update public.dynamo_wallet_ledger l set reason=case when c.kind='awards' then 'Award purchase' else 'Booking payment' end from public.dynamo_transactions t join public.dynamo_card_checkouts c on c.id=t.card_checkout_id where l.purchase_id=t.purchase_id and l.reason='Checkout wallet reservation' and c.state='paid';
delete from public.dynamo_wallet_ledger l where l.reason='Checkout wallet reservation' and exists(select 1 from public.dynamo_transactions t join public.dynamo_card_checkouts c on c.id=t.card_checkout_id where t.purchase_id=l.purchase_id and c.state<>'paid');
delete from public.dynamo_wallet_ledger l where l.reason='Unpaid checkout: wallet credit released' and exists(select 1 from public.dynamo_card_checkouts c where c.id=l.operation_id and c.state='expired');
-- Rebase displayed running balances after removing temporary movements.
with balances as (
 select l.id,a.wallet_pence-coalesce(sum(l.amount_pence) over(partition by l.account_id order by l.created_at desc,l.id desc rows between unbounded preceding and 1 preceding),0) as balance
 from public.dynamo_wallet_ledger l join public.dynamo_accounts a on a.id=l.account_id where l.account_id in(select account_id from wallet_display_accounts)
) update public.dynamo_wallet_ledger l set balance_pence=b.balance from balances b where l.id=b.id;
create or replace function public.dynamo_wallet_reserved(p_account uuid) returns bigint language sql stable security invoker set search_path='' as $reserved$
select coalesce(sum(wallet_pence),0)::bigint from public.dynamo_card_checkouts where account_id=p_account and state in ('creating','open','review') and not wallet_debited and id::text is distinct from nullif(current_setting('dynamo.preparing_checkout',true),'');
$reserved$;
revoke all on function public.dynamo_wallet_reserved(uuid) from public,anon,authenticated;
grant execute on function public.dynamo_wallet_reserved(uuid) to service_role;
CREATE OR REPLACE FUNCTION public.adjust_dynamo_wallet(p_account uuid, p_actor uuid, p_amount bigint, p_reason text, p_operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare balance bigint;prior public.dynamo_wallet_ledger%rowtype;
begin
 select wallet_pence into balance from public.dynamo_accounts where id=p_account for update;if not found then raise exception 'ACCOUNT_NOT_FOUND';end if;
 select * into prior from public.dynamo_wallet_ledger where operation_id=p_operation;if found then if prior.account_id<>p_account or prior.amount_pence<>p_amount then raise exception 'OPERATION_CONFLICT';end if;return jsonb_build_object('balance',balance,'unchanged',true);end if;
 if p_amount=0 or abs(p_amount)>1000000 or length(btrim(p_reason))<3 or length(p_reason)>300 then raise exception 'INVALID_WALLET_CHANGE';end if;
 if balance+p_amount<0 then raise exception 'INSUFFICIENT_CREDIT';end if;
 if p_amount<0 and balance+p_amount<public.dynamo_wallet_reserved(p_account) then raise exception 'WALLET_CREDIT_IN_USE';end if;
 balance:=balance+p_amount;update public.dynamo_accounts set wallet_pence=balance where id=p_account;
 insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason) values(p_operation,p_account,p_actor,p_amount,balance,p_reason);
 return jsonb_build_object('balance',balance);
end;$function$
;
CREATE OR REPLACE FUNCTION public.book_dynamo_event_priced(p_kind text, p_target uuid, p_account uuid, p_gymnast uuid, p_credit boolean, p_operation uuid, p_price bigint, p_selection jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare account public.dynamo_accounts%rowtype;gym public.dynamo_gymnasts%rowtype;info jsonb;price bigint;purchase uuid;booking uuid;capacity integer;count_booked integer;prior public.dynamo_booking_actions%rowtype;
begin
 if p_kind<>'event' then raise exception 'INVALID_BOOKING';end if;perform pg_advisory_xact_lock(719442004);
 select * into prior from public.dynamo_booking_actions where id=p_operation;if found then if prior.actor_id<>p_account or prior.kind<>p_kind or prior.details->>'target'<>p_target::text or prior.details->>'gymnast'<>p_gymnast::text then raise exception 'OPERATION_CONFLICT';end if;return jsonb_build_object('bookingId',prior.booking_id,'unchanged',true);end if;
 select * into account from public.dynamo_accounts where id=p_account for update;if not found then raise exception 'ACCOUNT_NOT_FOUND';end if;
 select * into gym from public.dynamo_gymnasts where id=p_gymnast and account_id=p_account;if not found then raise exception 'GYMNAST_NOT_FOUND';end if;
 if p_kind='event' then select details into info from public.dynamo_events where id=p_target and not archived for update;if not found or info->>'status'<>'Published' then raise exception 'SESSION_UNAVAILABLE';end if;
  info:=info||p_selection;capacity:=(info->>'capacity')::integer;select count(*) into count_booked from public.dynamo_event_bookings where event_id=p_target and status='Booked';
  if info->>'audience'<>'everyone' and (gym.id is null or not gym.active or cardinality(gym.groups)=0 or (info->>'audience'='groups' and not exists(select 1 from jsonb_array_elements_text(info->'allowedGroups') g where g=any(gym.groups)))) then raise exception 'SESSION_INELIGIBLE';end if;
 elsif p_kind='party' then select details into info from public.dynamo_parties where id=p_target and not archived for update;if not found or info->>'status' in ('Cancelled','Blocked') then raise exception 'SESSION_UNAVAILABLE';end if;
  capacity:=1;select count(*) into count_booked from public.dynamo_party_bookings where party_id=p_target and status='Booked';
 else raise exception 'INVALID_BOOKING';end if;
 if ((info->>'date')||' '||(info->>'time'))::timestamp at time zone 'Europe/London'<=now() or capacity is null or count_booked>=capacity then raise exception 'SESSION_FULL';end if;
 if p_kind='event' and exists(select 1 from public.dynamo_event_bookings where event_id=p_target and gymnast_id=p_gymnast and status='Booked') then raise exception 'ALREADY_BOOKED';end if;
 price:=p_price;
 if price is null or price<0 then raise exception 'PRICE_NOT_CONFIGURED';end if;
 if price>0 and (not p_credit or account.wallet_pence-public.dynamo_wallet_reserved(p_account)<price) then raise exception 'CARD_PAYMENT_NOT_CONNECTED';end if;
 insert into public.dynamo_purchases(account_id,details) values(p_account,jsonb_build_object('name',info->>'name','kind',p_kind,'targetId',p_target,'originalDate',info->>'date','originalTime',info->>'time','pricePence',price,'selection',p_selection)) returning id into purchase;
 if price>0 then update public.dynamo_accounts set wallet_pence=wallet_pence-price where id=p_account;
 insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason,purchase_id) values(p_operation,p_account,p_account,-price,account.wallet_pence-price,'Booking payment',purchase);end if;
 insert into public.dynamo_transactions(account_id,purchase_id,amount_pence,status,payment_method) values(p_account,purchase,price,'successful','wallet');
 if p_kind='event' then insert into public.dynamo_event_bookings(event_id,account_id,gymnast_id,purchase_id,price_pence,selection) values(p_target,p_account,p_gymnast,purchase,price,p_selection) returning id into booking;
 else insert into public.dynamo_party_bookings(party_id,account_id,gymnast_id,purchase_id,price_pence) values(p_target,p_account,p_gymnast,purchase,price) returning id into booking;end if;
 insert into public.dynamo_booking_actions(id,booking_id,kind,action,actor_id,details) values(p_operation,booking,p_kind,'created',p_account,jsonb_build_object('target',p_target,'gymnast',p_gymnast));
 return jsonb_build_object('bookingId',booking,'pricePence',price,'walletBalance',account.wallet_pence-price);
end;$function$
;
CREATE OR REPLACE FUNCTION public.book_dynamo_session(p_kind text, p_target uuid, p_account uuid, p_gymnast uuid, p_credit boolean, p_operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare account public.dynamo_accounts%rowtype;gym public.dynamo_gymnasts%rowtype;info jsonb;price bigint;purchase uuid;booking uuid;capacity integer;count_booked integer;prior public.dynamo_booking_actions%rowtype;
begin
 perform pg_advisory_xact_lock(719442004);
 select * into prior from public.dynamo_booking_actions where id=p_operation;if found then if prior.actor_id<>p_account or prior.kind<>p_kind or prior.details->>'target'<>p_target::text or prior.details->>'gymnast'<>p_gymnast::text then raise exception 'OPERATION_CONFLICT';end if;return jsonb_build_object('bookingId',prior.booking_id,'unchanged',true);end if;
 select * into account from public.dynamo_accounts where id=p_account for update;if not found then raise exception 'ACCOUNT_NOT_FOUND';end if;
 select * into gym from public.dynamo_gymnasts where id=p_gymnast and account_id=p_account;if not found then raise exception 'GYMNAST_NOT_FOUND';end if;
 if p_kind='event' then select details into info from public.dynamo_events where id=p_target and not archived for update;if not found or info->>'status'<>'Published' then raise exception 'SESSION_UNAVAILABLE';end if;
  capacity:=(info->>'capacity')::integer;select count(*) into count_booked from public.dynamo_event_bookings where event_id=p_target and status='Booked';
  if info->>'audience'<>'everyone' and (gym.id is null or not gym.active or cardinality(gym.groups)=0 or (info->>'audience'='groups' and not exists(select 1 from jsonb_array_elements_text(info->'allowedGroups') g where g=any(gym.groups)))) then raise exception 'SESSION_INELIGIBLE';end if;
 elsif p_kind='party' then select details into info from public.dynamo_parties where id=p_target and not archived for update;if not found or info->>'status' in ('Cancelled','Blocked') then raise exception 'SESSION_UNAVAILABLE';end if;
  capacity:=1;select count(*) into count_booked from public.dynamo_party_bookings where party_id=p_target and status='Booked';
 else raise exception 'INVALID_BOOKING';end if;
 if ((info->>'date')||' '||(info->>'time'))::timestamp at time zone 'Europe/London'<=now() or capacity is null or count_booked>=capacity then raise exception 'SESSION_FULL';end if;
 if p_kind='event' and exists(select 1 from public.dynamo_event_bookings where event_id=p_target and gymnast_id=p_gymnast and status='Booked') then raise exception 'ALREADY_BOOKED';end if;
 price:=(info->>(case when public.dynamo_account_is_member(account.id) then 'memberPriceCents' else 'nonMemberPriceCents' end))::bigint;
 if price is null or price<0 then raise exception 'PRICE_NOT_CONFIGURED';end if;
 if price>0 and (not p_credit or account.wallet_pence-public.dynamo_wallet_reserved(p_account)<price) then raise exception 'CARD_PAYMENT_NOT_CONNECTED';end if;
 insert into public.dynamo_purchases(account_id,details) values(p_account,jsonb_build_object('name',info->>'name','kind',p_kind,'targetId',p_target,'originalDate',info->>'date','originalTime',info->>'time','pricePence',price)) returning id into purchase;
 if price>0 then update public.dynamo_accounts set wallet_pence=wallet_pence-price where id=p_account;
 insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason,purchase_id) values(p_operation,p_account,p_account,-price,account.wallet_pence-price,'Booking payment',purchase);end if;
 insert into public.dynamo_transactions(account_id,purchase_id,amount_pence,status,payment_method) values(p_account,purchase,price,'successful','wallet');
 if p_kind='event' then insert into public.dynamo_event_bookings(event_id,account_id,gymnast_id,purchase_id,price_pence) values(p_target,p_account,p_gymnast,purchase,price) returning id into booking;
 else insert into public.dynamo_party_bookings(party_id,account_id,gymnast_id,purchase_id,price_pence) values(p_target,p_account,p_gymnast,purchase,price) returning id into booking;end if;
 insert into public.dynamo_booking_actions(id,booking_id,kind,action,actor_id,details) values(p_operation,booking,p_kind,'created',p_account,jsonb_build_object('target',p_target,'gymnast',p_gymnast));
 return jsonb_build_object('bookingId',booking,'pricePence',price,'walletBalance',account.wallet_pence-price);
end;$function$
;
CREATE OR REPLACE FUNCTION public.book_dynamo_session_v2(p_kind text, p_target uuid, p_account uuid, p_gymnast uuid, p_credit boolean, p_operation uuid, p_room_addon boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare account public.dynamo_accounts%rowtype;gym public.dynamo_gymnasts%rowtype;info jsonb;price bigint;purchase uuid;booking uuid;capacity integer;count_booked integer;prior public.dynamo_booking_actions%rowtype;cfg jsonb;
begin
 perform pg_advisory_xact_lock(719442004);
 select * into prior from public.dynamo_booking_actions where id=p_operation;if found then if prior.actor_id<>p_account or prior.kind<>p_kind or prior.details->>'target'<>p_target::text or prior.details->>'gymnast'<>p_gymnast::text or coalesce((prior.details->>'roomAddon')::boolean,false)<>p_room_addon then raise exception 'OPERATION_CONFLICT';end if;return jsonb_build_object('bookingId',prior.booking_id,'unchanged',true);end if;
 select * into account from public.dynamo_accounts where id=p_account for update;if not found then raise exception 'ACCOUNT_NOT_FOUND';end if;
 select * into gym from public.dynamo_gymnasts where id=p_gymnast and account_id=p_account;if not found then raise exception 'GYMNAST_NOT_FOUND';end if;
 if p_kind='event' then select details into info from public.dynamo_events where id=p_target and not archived for update;if not found or info->>'status'<>'Published' then raise exception 'SESSION_UNAVAILABLE';end if;
  capacity:=(info->>'capacity')::integer;select count(*) into count_booked from public.dynamo_event_bookings where event_id=p_target and status='Booked';
  if info->>'audience'<>'everyone' and (gym.id is null or not gym.active or cardinality(gym.groups)=0 or (info->>'audience'='groups' and not exists(select 1 from jsonb_array_elements_text(info->'allowedGroups') g where g=any(gym.groups)))) then raise exception 'SESSION_INELIGIBLE';end if;
 elsif p_kind='party' then select details into info from public.dynamo_parties where id=p_target and not archived for update;if not found or info->>'status' in ('Cancelled','Blocked') then raise exception 'SESSION_UNAVAILABLE';end if;
  capacity:=1;select count(*) into count_booked from public.dynamo_party_bookings where party_id=p_target and status='Booked';
 else raise exception 'INVALID_BOOKING';end if;
 if ((info->>'date')||' '||(info->>'time'))::timestamp at time zone 'Europe/London'<=now() or capacity is null or count_booked>=capacity then raise exception 'SESSION_FULL';end if;
 if p_kind='event' and exists(select 1 from public.dynamo_event_bookings where event_id=p_target and gymnast_id=p_gymnast and status='Booked') then raise exception 'ALREADY_BOOKED';end if;
 price:=(info->>(case when public.dynamo_account_is_member(account.id) then 'memberPriceCents' else 'nonMemberPriceCents' end))::bigint;
 if p_kind='party' then price:=public.dynamo_party_price(p_target,public.dynamo_account_is_member(account.id),p_room_addon);select details into cfg from public.dynamo_party_types where id=coalesce(info->>'partyType',case when info->>'room'='Small gym' then 'preschool' else 'dynamo' end);info:=info||jsonb_build_object('name',cfg->>'name','activityMinutes',cfg->'activityMinutes','partyRoomMinutes',case when (cfg->>'roomIncluded')::boolean or p_room_addon then (cfg->>'roomMinutes')::integer else 0 end);end if;
 if price is null or price<0 then raise exception 'PRICE_NOT_CONFIGURED';end if;
 if price>0 and (not p_credit or account.wallet_pence-public.dynamo_wallet_reserved(p_account)<price) then raise exception 'CARD_PAYMENT_NOT_CONNECTED';end if;
 insert into public.dynamo_purchases(account_id,details) values(p_account,jsonb_build_object('name',info->>'name','kind',p_kind,'targetId',p_target,'originalDate',info->>'date','originalTime',info->>'time','pricePence',price,'roomAddon',p_room_addon,'activityMinutes',info->'activityMinutes','partyRoomMinutes',info->'partyRoomMinutes')) returning id into purchase;
 if price>0 then update public.dynamo_accounts set wallet_pence=wallet_pence-price where id=p_account;
 insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason,purchase_id) values(p_operation,p_account,p_account,-price,account.wallet_pence-price,'Booking payment',purchase);end if;
 insert into public.dynamo_transactions(account_id,purchase_id,amount_pence,status,payment_method) values(p_account,purchase,price,'successful','wallet');
 if p_kind='event' then insert into public.dynamo_event_bookings(event_id,account_id,gymnast_id,purchase_id,price_pence) values(p_target,p_account,p_gymnast,purchase,price) returning id into booking;
 else insert into public.dynamo_party_bookings(party_id,account_id,gymnast_id,purchase_id,price_pence) values(p_target,p_account,p_gymnast,purchase,price) returning id into booking;end if;
 insert into public.dynamo_booking_actions(id,booking_id,kind,action,actor_id,details) values(p_operation,booking,p_kind,'created',p_account,jsonb_build_object('target',p_target,'gymnast',p_gymnast,'roomAddon',p_room_addon));
 return jsonb_build_object('bookingId',booking,'pricePence',price,'walletBalance',account.wallet_pence-price);
end;$function$
;
CREATE OR REPLACE FUNCTION public.checkout_dynamo_awards(p_account uuid, p_items jsonb, p_operation uuid, p_expected_total bigint, p_credit boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare owner public.dynamo_accounts%rowtype;gym public.dynamo_gymnasts%rowtype;award public.dynamo_awards%rowtype;prior public.dynamo_award_orders%rowtype;item jsonb;lines jsonb:='[]'::jsonb;total bigint:=0;price bigint;purchase uuid;tx uuid;result jsonb;
begin
 perform pg_advisory_xact_lock(719442001);perform pg_advisory_xact_lock(719442004);
 select * into prior from public.dynamo_award_orders where id=p_operation;
 if found then if prior.account_id<>p_account or prior.items<>p_items then raise exception 'OPERATION_CONFLICT';end if;return prior.result||'{"unchanged":true}'::jsonb;end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20 or p_expected_total is null or p_expected_total<0 then raise exception 'INVALID_AWARD_ORDER';end if;
 if (select count(distinct x->>'gymnastId') from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) then raise exception 'INVALID_AWARD_ORDER';end if;
 select * into owner from public.dynamo_accounts where id=p_account for update;
 if not found or not public.dynamo_account_is_member(owner.id) then raise exception 'MEMBER_REQUIRED';end if;
 for item in select * from jsonb_array_elements(p_items) loop
  select * into gym from public.dynamo_gymnasts where id=(item->>'gymnastId')::uuid and account_id=p_account for update;
  if not found or not gym.active then raise exception 'GYMNAST_INELIGIBLE';end if;
  select * into award from public.dynamo_awards where id=(item->>'awardId')::uuid and not archived for update;
  if not found or not coalesce((award.details->>'enabled')::boolean,false) then raise exception 'AWARD_UNAVAILABLE';end if;
  if award.details->>'category' not in ('gymini','recreational') or not (award.details->>'category'=any(gym.groups)) then raise exception 'GYMNAST_INELIGIBLE';end if;
  if trim(gym.time_class)='' then raise exception 'CLASS_NOT_SYNCED';end if;
  if item->>'expectedSession' is distinct from gym.time_class then raise exception 'CLASS_CHANGED';end if;
  if exists(select 1 from public.dynamo_award_items where gymnast_id=gym.id and award_id=award.id) then raise exception 'AWARD_ALREADY_PURCHASED';end if;
  price:=(award.details->>'priceCents')::bigint;if price is null or price<0 then raise exception 'PRICE_NOT_CONFIGURED';end if;
  total:=total+price;
  lines:=lines||jsonb_build_array(jsonb_build_object('gymnastId',gym.id,'gymnastName',gym.first_name||' '||gym.last_name,'session',gym.time_class,'awardId',award.id,'awardName',award.details->>'name','category',award.details->>'category','pricePence',price));
 end loop;
 if total<>p_expected_total then raise exception 'PRICE_CHANGED';end if;
 if total>0 and (p_credit is not true or owner.wallet_pence-public.dynamo_wallet_reserved(p_account)<total) then raise exception 'CARD_PAYMENT_NOT_CONNECTED';end if;
 insert into public.dynamo_purchases(account_id,details) values(p_account,jsonb_build_object('name','Gymnastics awards','kind','award','items',lines,'pricePence',total)) returning id into purchase;
 if total>0 then update public.dynamo_accounts set wallet_pence=wallet_pence-total where id=p_account;
 insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason,purchase_id) values(p_operation,p_account,p_account,-total,owner.wallet_pence-total,'Award purchase',purchase);end if;
 insert into public.dynamo_transactions(account_id,purchase_id,amount_pence,status,payment_method) values(p_account,purchase,total,'successful','wallet') returning id into tx;
 result:=jsonb_build_object('orderId',p_operation,'purchaseId',purchase,'transactionId',tx,'totalPence',total,'walletBalance',owner.wallet_pence-total);
 insert into public.dynamo_award_orders(id,account_id,purchase_id,items,result) values(p_operation,p_account,purchase,p_items,result);
 for item in select * from jsonb_array_elements(lines) loop insert into public.dynamo_award_items(order_id,account_id,gymnast_id,award_id,details) values(p_operation,p_account,(item->>'gymnastId')::uuid,(item->>'awardId')::uuid,item);end loop;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.prepare_dynamo_card_checkout(p_account uuid, p_kind text, p_items jsonb, p_credit boolean, p_operation uuid, p_expected_total bigint, p_connected text, p_origin text DEFAULT 'https://dynamo-gymnastics.vercel.app'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare previous public.dynamo_card_checkouts%rowtype; balance bigint; used bigint; remaining bigint; v_result jsonb; ids uuid[]; rec record; portion bigint; running bigint;fee bigint;fee_left bigint;fee_part bigint;card_left bigint;
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
 insert into public.dynamo_card_checkouts(id,account_id,kind,items,credit,total_pence,wallet_pence,card_pence,credit_left,connected_account,return_origin,service_fee_pence) values(p_operation,p_account,p_kind,p_items,p_credit,p_expected_total,used,p_expected_total-used,used,p_connected,p_origin,case when p_expected_total-used>0 then ((p_expected_total-used)*250+5000)/10000+20 else 0 end);
 update public.dynamo_accounts set wallet_pence=p_expected_total where id=p_account;
 perform set_config('dynamo.preparing_checkout',p_operation::text,true);
 if p_kind='basket' then v_result:=public.checkout_dynamo_basket(p_account,p_items,true,p_operation,p_expected_total);
 select array_agg(purchase_id) into ids from (select purchase_id from public.dynamo_event_bookings where id in(select (v->>'bookingId')::uuid from jsonb_array_elements(v_result->'bookings') v) union all select purchase_id from public.dynamo_party_bookings where id in(select (v->>'bookingId')::uuid from jsonb_array_elements(v_result->'bookings') v)) purchases;
 else v_result:=public.checkout_dynamo_awards(p_account,p_items,p_operation,p_expected_total,true);ids:=array[(v_result->>'purchaseId')::uuid];end if;
 perform set_config('dynamo.preparing_checkout','',true);
 delete from public.dynamo_wallet_ledger where purchase_id=any(ids) and account_id=p_account and amount_pence<0;
 update public.dynamo_accounts set wallet_pence=balance-case when p_expected_total-used=0 then used else 0 end where id=p_account;remaining:=used;running:=balance;
 for rec in select * from public.dynamo_transactions where purchase_id=any(ids) order by created_at,id for update loop
 portion:=least(remaining,rec.amount_pence);remaining:=remaining-portion;running:=running-portion;
 if portion>0 and p_expected_total-used=0 then
 insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason,purchase_id) values(gen_random_uuid(),p_account,p_account,-portion,running,case when p_kind='awards' then 'Award purchase' else 'Booking payment' end,rec.purchase_id);
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
 fee:=case when p_expected_total-used>0 then ((p_expected_total-used)*250+5000)/10000+20 else 0 end;fee_left:=fee;card_left:=p_expected_total-used;
 for rec in select * from public.dynamo_transactions where card_checkout_id=p_operation and payment_method='card' order by created_at,id for update loop
 fee_part:=case when rec.amount_pence=card_left then fee_left else fee_left*rec.amount_pence/card_left end;
 update public.dynamo_transactions set service_fee_pence=fee_part where id=rec.id;fee_left:=fee_left-fee_part;card_left:=card_left-rec.amount_pence;end loop;
 v_result:=v_result||jsonb_build_object('walletBalance',balance-case when p_expected_total-used=0 then used else 0 end,'totalPence',p_expected_total);
 update public.dynamo_card_checkouts set result=v_result,wallet_debited=p_expected_total-used=0,state=case when p_expected_total-used=0 then 'paid' else 'creating' end,settled_at=case when p_expected_total-used=0 then now() else null end where id=p_operation;
 select * into previous from public.dynamo_card_checkouts where id=p_operation;return to_jsonb(previous);
end $function$
;
CREATE OR REPLACE FUNCTION public.settle_dynamo_card_checkout(p_order uuid, p_session text, p_payment text, p_amount bigint, p_paid boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.dynamo_card_checkouts%rowtype; ids uuid[]; balance bigint;running bigint;rec record;begin
 perform pg_advisory_xact_lock(719442001);perform pg_advisory_xact_lock(719442004);
 select * into r from public.dynamo_card_checkouts where id=p_order for update;if not found then raise exception 'CHECKOUT_NOT_FOUND';end if;
 if r.session_id is distinct from p_session or r.card_pence<>p_amount or p_paid and coalesce(p_payment,'') !~ '^pi_[a-zA-Z0-9]+$' then raise exception 'PAYMENT_MISMATCH';end if;
 if r.state in ('paid','expired') then return jsonb_build_object('state',r.state,'unchanged',true,'accountId',r.account_id,'result',r.result);end if;
 select array_agg(distinct purchase_id) into ids from public.dynamo_transactions where card_checkout_id=p_order;
 if p_paid then
 if not r.wallet_debited then
 select wallet_pence into balance from public.dynamo_accounts where id=r.account_id for update;
 if balance<r.wallet_pence then raise exception 'INSUFFICIENT_CREDIT';end if;
 if coalesce((select sum(amount_pence) from public.dynamo_transactions where card_checkout_id=p_order and payment_method='wallet'),0)<>r.wallet_pence then raise exception 'PAYMENT_MISMATCH';end if;
 running:=balance;
 for rec in select * from public.dynamo_transactions where card_checkout_id=p_order and payment_method='wallet' and amount_pence>0 order by created_at,id loop
 running:=running-rec.amount_pence;
 insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason,purchase_id) values(rec.id,r.account_id,r.account_id,-rec.amount_pence,running,case when r.kind='awards' then 'Award purchase' else 'Booking payment' end,rec.purchase_id);
 end loop;
 update public.dynamo_accounts set wallet_pence=balance-r.wallet_pence where id=r.account_id;
 update public.dynamo_card_checkouts set wallet_debited=true,result=result||jsonb_build_object('walletBalance',balance-r.wallet_pence) where id=p_order;
 end if;
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
 update public.dynamo_transactions set status=case when payment_attempt_failed then 'declined' else 'pending' end where card_checkout_id=p_order;
 -- Only provisional award items are removed. The unsuccessful purchase remains in history.
 delete from public.dynamo_award_items where order_id=p_order;
 update public.dynamo_award_orders set payment_pending=false where id=p_order;
 -- No wallet debit occurred, so expiry needs no wallet transaction.
 end if;
 update public.dynamo_purchases set details=details||jsonb_build_object('paymentStatus',case when p_paid then 'paid' else 'expired' end) where id=any(ids);
 update public.dynamo_card_checkouts set state=case when p_paid then 'paid' else 'expired' end,payment_intent=p_payment,settled_at=now() where id=p_order;
 return jsonb_build_object('state',case when p_paid then 'paid' else 'expired' end,'accountId',r.account_id,'result',r.result);
end $function$
;
commit;
