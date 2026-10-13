create table if not exists public.dynamo_party_types(id text primary key check(id in ('preschool','dynamo')),details jsonb not null);
alter table public.dynamo_party_types enable row level security;
revoke all on public.dynamo_party_types from anon,authenticated;
grant select,insert,update on public.dynamo_party_types to service_role;
insert into public.dynamo_party_types(id,details) values('preschool','{"name": "Pre-School Party", "room": "Small gym", "day": 6, "times": ["14:30"], "activityMinutes": 60, "roomMinutes": 30, "roomIncluded": false, "addonEnabled": true, "guests": 15, "memberPriceCents": 9500, "nonMemberPriceCents": 9500, "roomMemberPriceCents": null, "roomNonMemberPriceCents": null, "enabled": true, "information": "Explore the soft play equipment, bounce on the trampoline and enjoy fun songs in the small gym.\n\nOne hour in the pre-school gym with qualified British Gymnastics coaches. Adults stay to supervise their children.\n\nYou can add 30 minutes in the party room after the activity for an additional charge."}'::jsonb) on conflict(id) do nothing;
insert into public.dynamo_party_types(id,details) values('dynamo','{"name": "Dynamo Party", "room": "Big gym", "day": 0, "times": ["13:00", "14:15", "15:30"], "activityMinutes": 60, "roomMinutes": 45, "roomIncluded": true, "addonEnabled": false, "guests": 25, "memberPriceCents": 22500, "nonMemberPriceCents": 22500, "roomMemberPriceCents": null, "roomNonMemberPriceCents": null, "enabled": true, "information": "Foam pits, trampolines, beams and fun games in the big gym, followed by time to celebrate.\n\nOne hour of gymnastics activities with qualified British Gymnastics coaches, followed by 45 minutes in the party room, included in your party price."}'::jsonb) on conflict(id) do nothing;
create or replace function public.guard_dynamo_party_settings() returns trigger language plpgsql security invoker set search_path='' as $$begin perform pg_advisory_xact_lock(719442004);return new;end;$$;
revoke all on function public.guard_dynamo_party_settings() from public,anon,authenticated;
create trigger guard_party_settings before update on public.dynamo_party_types for each row execute function public.guard_dynamo_party_settings();
create or replace function public.dynamo_party_price(p_target uuid,p_member boolean,p_addon boolean) returns bigint language plpgsql security invoker set search_path='' as $$
declare info jsonb;cfg jsonb;price bigint;extra bigint;begin
 select details into info from public.dynamo_parties where id=p_target and not archived;
 if info is null or info->>'status' in ('Blocked','Cancelled') then raise exception 'SESSION_UNAVAILABLE';end if;
 select details into cfg from public.dynamo_party_types where id=coalesce(info->>'partyType',case when info->>'room'='Small gym' then 'preschool' else 'dynamo' end);
 if cfg is null or not coalesce((cfg->>'enabled')::boolean,false) or cfg->>'room'<>info->>'room' or extract(dow from (info->>'date')::date)::integer<>(cfg->>'day')::integer or not ((cfg->'times') ? (info->>'time')) then raise exception 'SESSION_UNAVAILABLE';end if;
 price:=(cfg->>(case when p_member then 'memberPriceCents' else 'nonMemberPriceCents' end))::bigint;
 if p_addon then if not coalesce((cfg->>'addonEnabled')::boolean,false) or (cfg->>'roomIncluded')::boolean then raise exception 'SESSION_UNAVAILABLE';end if;extra:=(cfg->>(case when p_member then 'roomMemberPriceCents' else 'roomNonMemberPriceCents' end))::bigint;if extra is null then raise exception 'PRICE_NOT_CONFIGURED';end if;price:=price+extra;end if;
 if price is null or price<0 then raise exception 'PRICE_NOT_CONFIGURED';end if;return price;
end;$$;
create or replace function public.book_dynamo_session_v2(p_kind text,p_target uuid,p_account uuid,p_gymnast uuid,p_credit boolean,p_operation uuid,p_room_addon boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
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
 price:=(info->>(case when account.roster_member then 'memberPriceCents' else 'nonMemberPriceCents' end))::bigint;
 if p_kind='party' then price:=public.dynamo_party_price(p_target,account.roster_member,p_room_addon);select details into cfg from public.dynamo_party_types where id=coalesce(info->>'partyType',case when info->>'room'='Small gym' then 'preschool' else 'dynamo' end);info:=info||jsonb_build_object('name',cfg->>'name','activityMinutes',cfg->'activityMinutes','partyRoomMinutes',case when (cfg->>'roomIncluded')::boolean or p_room_addon then (cfg->>'roomMinutes')::integer else 0 end);end if;
 if price is null or price<0 then raise exception 'PRICE_NOT_CONFIGURED';end if;
 if price>0 and (not p_credit or account.wallet_pence<price) then raise exception 'CARD_PAYMENT_NOT_CONNECTED';end if;
 insert into public.dynamo_purchases(account_id,details) values(p_account,jsonb_build_object('name',info->>'name','kind',p_kind,'targetId',p_target,'originalDate',info->>'date','originalTime',info->>'time','pricePence',price,'roomAddon',p_room_addon,'activityMinutes',info->'activityMinutes','partyRoomMinutes',info->'partyRoomMinutes')) returning id into purchase;
 if price>0 then update public.dynamo_accounts set wallet_pence=wallet_pence-price where id=p_account;
 insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason,purchase_id) values(p_operation,p_account,p_account,-price,account.wallet_pence-price,'Booking payment',purchase);end if;
 insert into public.dynamo_transactions(account_id,purchase_id,amount_pence,status,payment_method) values(p_account,purchase,price,'successful','wallet');
 if p_kind='event' then insert into public.dynamo_event_bookings(event_id,account_id,gymnast_id,purchase_id,price_pence) values(p_target,p_account,p_gymnast,purchase,price) returning id into booking;
 else insert into public.dynamo_party_bookings(party_id,account_id,gymnast_id,purchase_id,price_pence) values(p_target,p_account,p_gymnast,purchase,price) returning id into booking;end if;
 insert into public.dynamo_booking_actions(id,booking_id,kind,action,actor_id,details) values(p_operation,booking,p_kind,'created',p_account,jsonb_build_object('target',p_target,'gymnast',p_gymnast,'roomAddon',p_room_addon));
 return jsonb_build_object('bookingId',booking,'pricePence',price,'walletBalance',account.wallet_pence-price);
end;$$;
create or replace function public.checkout_dynamo_basket(p_account uuid,p_items jsonb,p_credit boolean,p_operation uuid,p_expected_total bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.dynamo_basket_checkouts%rowtype; item jsonb; result jsonb; results jsonb:='[]'; expected bigint:=0; price bigint; member boolean; begin
 perform pg_advisory_xact_lock(719442004);
 select * into prior from public.dynamo_basket_checkouts where id=p_operation;
 if found then if prior.account_id<>p_account or prior.items<>p_items then raise exception 'OPERATION_CONFLICT';end if;return prior.result;end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>50 then raise exception 'INVALID_BOOKING';end if;
 select roster_member into member from public.dynamo_accounts where id=p_account for update;
 for item in select value from jsonb_array_elements(p_items) loop
 if item->>'kind'='event' then select (details->>(case when member then 'memberPriceCents' else 'nonMemberPriceCents' end))::bigint into price from public.dynamo_events where id=(item->>'targetId')::uuid;else price:=public.dynamo_party_price((item->>'targetId')::uuid,member,coalesce((item->>'roomAddon')::boolean,false));end if;
 if price is null then raise exception 'SESSION_UNAVAILABLE';end if;expected:=expected+price;end loop;
 if p_expected_total is null or expected<>p_expected_total then raise exception 'PRICE_CHANGED';end if;
 for item in select value from jsonb_array_elements(p_items) loop
 if item->>'kind'='party' then result:=public.book_dynamo_session_v2('party',(item->>'targetId')::uuid,p_account,(item->>'gymnastId')::uuid,p_credit,gen_random_uuid(),coalesce((item->>'roomAddon')::boolean,false));else result:=public.book_dynamo_session('event',(item->>'targetId')::uuid,p_account,(item->>'gymnastId')::uuid,p_credit,gen_random_uuid());end if;results:=results||jsonb_build_array(result);
 end loop;
 result:=jsonb_build_object('ok',true,'bookings',results);
 insert into public.dynamo_basket_checkouts(id,account_id,items,result) values(p_operation,p_account,p_items,result);return result;
end $$;
revoke all on function public.dynamo_party_price(uuid,boolean,boolean),public.book_dynamo_session_v2(text,uuid,uuid,uuid,boolean,uuid,boolean) from public,anon,authenticated;
grant execute on function public.dynamo_party_price(uuid,boolean,boolean),public.book_dynamo_session_v2(text,uuid,uuid,uuid,boolean,uuid,boolean) to service_role;
-- Allow consecutive one-hour gym activities, independently of party-room time.
do $$declare def text;begin
 select pg_get_functiondef('public.manage_dynamo_party_slots(text,jsonb,date,date,text)'::regprocedure) into def;def:=replace(def,'<5400','<3600');execute def;
 select pg_get_functiondef('public.manage_dynamo_booking(text,uuid,uuid,text,uuid,text,text,uuid)'::regprocedure) into def;def:=replace(def,'<5400','<3600');execute def;
end $$;
