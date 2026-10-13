begin;
create or replace function public.dynamo_staff_manages_events(p_actor uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.dynamo_accounts a left join public.dynamo_staff_profiles s on s.account_id=a.id where a.id=p_actor and ((s.account_id is not null and s.enabled and (s.manual_staff or a.roster_staff) and coalesce(s.roles,array[s.role]) && array['super_admin','event_admin']) or (s.account_id is null and a.email=any(array['freddie@dynamogymnastics.co.uk','kerri@dynamogymnastics.co.uk','admin@dynamogymnastics.co.uk','kayleigh@dynamogymnastics.co.uk','karen@dynamogymnastics.co.uk','anthony@dynamogymnastics.co.uk','tayah@dynamogymnastics.co.uk']))))
$$;
create or replace function public.quote_dynamo_event_move(p_actor uuid,p_booking uuid,p_target uuid,p_option uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare booked public.dynamo_event_bookings%rowtype;line jsonb;info jsonb;paid bigint;refund_available boolean;g public.dynamo_gymnasts%rowtype;
begin
 if not public.dynamo_staff_manages_events(p_actor) then raise exception 'STAFF_FORBIDDEN';end if;
 select * into booked from public.dynamo_event_bookings where id=p_booking;if not found then raise exception 'BOOKING_NOT_FOUND';end if;if booked.status<>'Booked' then raise exception 'BOOKING_CANCELLED';end if;
 line:=public.dynamo_expand_event_selection(booked.account_id,jsonb_build_object('kind','event','targetId',p_target,'optionId',p_option,'gymnastId',booked.gymnast_id))->0;
 select details into info from public.dynamo_events where id=p_target;
 if p_target=booked.event_id and coalesce(p_option::text,'')=coalesce(booked.selection->>'optionId','') then raise exception 'SAME_SESSION';end if;
 select least(booked.price_pence,coalesce(sum(amount_pence-refunded_pence),booked.price_pence)),coalesce(bool_and(payment_method='wallet'),false) into paid,refund_available from public.dynamo_transactions where purchase_id=booked.purchase_id and status in ('successful','refunded');
 select * into g from public.dynamo_gymnasts where id=booked.gymnast_id and account_id=booked.account_id;
 return jsonb_build_object('paidPence',paid,'destinationPence',(line->>'_pricePence')::bigint,'differencePence',greatest(0,paid-(line->>'_pricePence')::bigint),'additionalPence',greatest(0,(line->>'_pricePence')::bigint-paid),'refundAvailable',refund_available,'selection',line->'_selection','fields',coalesce(info->'bookingFields','[]'),'gymnast',jsonb_build_object('id',g.id,'first_name',g.first_name,'last_name',g.last_name,'medical_details',g.medical_details),'previousAnswers',booked.responses);
end $$;
create or replace function public.move_dynamo_event_booking(p_actor uuid,p_booking uuid,p_target uuid,p_option uuid,p_return text,p_expected_paid bigint,p_expected_price bigint,p_acknowledge_extra boolean,p_answers jsonb,p_fields jsonb,p_operation uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare booked public.dynamo_event_bookings%rowtype;prior public.dynamo_booking_actions%rowtype;quote jsonb;info jsonb;gym public.dynamo_gymnasts%rowtype;snapshot jsonb;move_selection jsonb;paid bigint;new_price bigint;difference bigint;remaining bigint;portion bigint;balance bigint;tx record;refund_op uuid;result jsonb;
begin
 perform pg_advisory_xact_lock(719442004);perform pg_advisory_xact_lock(719442005);
 if not public.dynamo_staff_manages_events(p_actor) then raise exception 'STAFF_FORBIDDEN';end if;
 select * into prior from public.dynamo_booking_actions where id=p_operation;
 if found then if prior.booking_id<>p_booking or prior.actor_id<>p_actor or prior.action<>'move' or prior.details->>'toTarget'<>p_target::text or coalesce(prior.details->>'optionId','')<>coalesce(p_option::text,'') or prior.details->>'returnMethod' is distinct from p_return then raise exception 'OPERATION_CONFLICT';end if;return prior.details->'result';end if;
 quote:=public.quote_dynamo_event_move(p_actor,p_booking,p_target,p_option);paid:=(quote->>'paidPence')::bigint;new_price:=(quote->>'destinationPence')::bigint;difference:=(quote->>'differencePence')::bigint;
 if p_expected_paid is distinct from paid or p_expected_price is distinct from new_price then raise exception 'PRICE_CHANGED';end if;
 if new_price>paid and not coalesce(p_acknowledge_extra,false) then raise exception 'EXTRA_PAYMENT_ACKNOWLEDGEMENT';end if;
 if difference>0 and (p_return is null or p_return not in ('wallet','refund')) then raise exception 'RETURN_METHOD_REQUIRED';end if;
 if difference>0 and p_return='refund' and not (quote->>'refundAvailable')::boolean then raise exception 'CARD_REFUNDS_NOT_CONNECTED';end if;
 select * into booked from public.dynamo_event_bookings where id=p_booking for update;
 select details into info from public.dynamo_events where id=p_target and not archived for update;info:=info||(quote->'selection');
 if info is null or info->>'status'<>'Published' or ((info->>'date')||' '||(info->>'time'))::timestamp at time zone 'Europe/London'<=now() then raise exception 'SESSION_UNAVAILABLE';end if;
 if (select count(*) from public.dynamo_event_bookings where event_id=p_target and status='Booked' and id<>p_booking)>=(info->>'capacity')::integer then raise exception 'SESSION_FULL';end if;
 if exists(select 1 from public.dynamo_event_bookings where event_id=p_target and gymnast_id=booked.gymnast_id and status='Booked' and id<>p_booking) then raise exception 'ALREADY_BOOKED';end if;
 select * into gym from public.dynamo_gymnasts where id=booked.gymnast_id and account_id=booked.account_id;
 if info->>'audience'<>'everyone' and (gym.id is null or not gym.active or cardinality(gym.groups)=0 or (info->>'audience'='groups' and not exists(select 1 from jsonb_array_elements_text(info->'allowedGroups') g where g=any(gym.groups)))) then raise exception 'SESSION_INELIGIBLE';end if;
 snapshot:=public.validate_dynamo_booking_answers(booked.account_id,jsonb_build_object('kind','event','targetId',p_target,'gymnastId',booked.gymnast_id,'answers',p_answers,'fieldDefinitions',p_fields));
 move_selection:=quote->'selection'||jsonb_build_object('moved',true,'standardPricePence',new_price,'additionalDuePence',greatest(0,new_price-paid));
 update public.dynamo_event_bookings set event_id=p_target,selection=move_selection,price_pence=least(paid,new_price),responses=snapshot->'answers',medical_snapshot=snapshot->>'medical',checked_in_at=null,checked_in_by=null where id=p_booking;
 -- Return a cheaper-session difference as a recorded credit/refund, never an untracked balance change.
 if difference>0 then
  select wallet_pence into balance from public.dynamo_accounts where id=booked.account_id for update;remaining:=difference;
  for tx in select * from public.dynamo_transactions where purchase_id=booked.purchase_id and status='successful' and amount_pence>refunded_pence order by created_at,id for update loop
   portion:=least(remaining,tx.amount_pence-tx.refunded_pence);if portion<=0 then exit;end if;refund_op:=gen_random_uuid();
   update public.dynamo_transactions set refunded_pence=refunded_pence+portion,status=case when refunded_pence+portion=amount_pence then 'refunded' else status end where id=tx.id;
   insert into public.dynamo_refunds(id,transaction_id,actor_id,amount_pence,reason) values(refund_op,tx.id,p_actor,portion,case when p_return='wallet' then 'Move difference returned as wallet credit' else 'Move difference refunded to original wallet payment' end);
   balance:=balance+portion;
   insert into public.dynamo_wallet_ledger(operation_id,account_id,actor_id,amount_pence,balance_pence,reason,purchase_id) values(refund_op,booked.account_id,p_actor,portion,balance,case when p_return='wallet' then 'Booking move: price difference credited to wallet' else 'Booking move: original wallet payment refunded' end,booked.purchase_id);
   remaining:=remaining-portion;
  end loop;
  if remaining<>0 then raise exception 'PAYMENT_NOT_FOUND';end if;
  update public.dynamo_accounts set wallet_pence=balance where id=booked.account_id;
 end if;
 update public.dynamo_purchases set details=details||jsonb_build_object('name',info->>'name','currentTargetId',p_target,'currentDate',info->>'date','currentTime',info->>'time','selection',move_selection,'pricePence',least(paid,new_price)) where id=booked.purchase_id;
 result:=jsonb_build_object('ok',true,'differencePence',difference,'additionalDuePence',greatest(0,new_price-paid),'returnMethod',p_return,'bookingId',p_booking);
 insert into public.dynamo_booking_actions(id,booking_id,kind,action,actor_id,details) values(p_operation,p_booking,'event','move',p_actor,jsonb_build_object('fromTarget',booked.event_id,'toTarget',p_target,'optionId',p_option,'returnMethod',p_return,'previousSelection',booked.selection,'result',result));
 return result;
end $$;
revoke all on function public.dynamo_staff_manages_events(uuid),public.quote_dynamo_event_move(uuid,uuid,uuid,uuid),public.move_dynamo_event_booking(uuid,uuid,uuid,uuid,text,bigint,bigint,boolean,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.dynamo_staff_manages_events(uuid),public.quote_dynamo_event_move(uuid,uuid,uuid,uuid),public.move_dynamo_event_booking(uuid,uuid,uuid,uuid,text,bigint,bigint,boolean,jsonb,jsonb,uuid) to service_role;
commit;
