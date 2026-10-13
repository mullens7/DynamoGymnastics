begin;
create or replace function public.create_dynamo_manual_event_booking(p_actor uuid,p_operation uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.dynamo_basket_checkouts%rowtype;owner uuid;gym uuid;matches integer;item jsonb;line jsonb;snapshot jsonb;result jsonb;booking uuid;purchase uuid;full_price bigint;paid bigint;payment_status text:=p_input->>'paymentStatus';selection jsonb;
begin
 perform pg_advisory_xact_lock(719442004);
 if not exists(select 1 from public.dynamo_accounts a left join public.dynamo_staff_profiles s on s.account_id=a.id where a.id=p_actor and
 ((s.account_id is not null and s.enabled and (s.manual_staff or a.roster_staff) and coalesce(s.roles,array[s.role]) && array['super_admin','event_admin']) or
 (s.account_id is null and a.email=any(array['freddie@dynamogymnastics.co.uk','kerri@dynamogymnastics.co.uk','admin@dynamogymnastics.co.uk','kayleigh@dynamogymnastics.co.uk','karen@dynamogymnastics.co.uk','anthony@dynamogymnastics.co.uk','tayah@dynamogymnastics.co.uk'])))) then raise exception 'STAFF_FORBIDDEN';end if;
 select * into prior from public.dynamo_basket_checkouts where id=p_operation;
 if found then if prior.items<>jsonb_build_array(p_input) or prior.result->>'actorId'<>p_actor::text then raise exception 'OPERATION_CONFLICT';end if;return prior.result;end if;
 if p_operation is null or jsonb_typeof(p_input)<>'object' or payment_status not in ('Free','Full Amount Paid','Custom Amount Paid') or (p_input->>'email') is null or length(p_input->>'email') not between 3 and 254 or p_input->>'email'<>lower(trim(p_input->>'email')) then raise exception 'INVALID_MANUAL_PAYMENT';end if;
 insert into public.dynamo_accounts(email,owner_name) values(p_input->>'email',trim((p_input->>'parentFirstName')||' '||(p_input->>'parentLastName'))) on conflict(email) do update set owner_name=case when public.dynamo_accounts.owner_name='' then excluded.owner_name else public.dynamo_accounts.owner_name end returning id into owner;
 if p_input->>'gymnastId' is not null then
  select id into gym from public.dynamo_gymnasts where id=(p_input->>'gymnastId')::uuid and account_id=owner;if gym is null then raise exception 'GYMNAST_NOT_FOUND';end if;
 else
  select count(*),(array_agg(id))[1] into matches,gym from public.dynamo_gymnasts where account_id=owner and lower(first_name)=lower(p_input->>'firstName') and lower(last_name)=lower(p_input->>'lastName') and date_of_birth=p_input->>'dateOfBirth';
  if matches>1 then raise exception 'AMBIGUOUS_GYMNAST';end if;
  if matches=0 then
   if length(trim(p_input->>'firstName')) not between 1 and 80 or length(trim(p_input->>'lastName')) not between 1 and 80 or p_input->>'dateOfBirth' is null then raise exception 'GYMNAST_NOT_FOUND';end if;
   insert into public.dynamo_gymnasts(account_id,source_id,first_name,last_name,date_of_birth,bg_number) values(owner,'manual:'||gen_random_uuid(),trim(p_input->>'firstName'),trim(p_input->>'lastName'),p_input->>'dateOfBirth',coalesce(p_input->>'bgNumber','')) returning id into gym;
  end if;
 end if;
 item:=p_input||jsonb_build_object('kind','event','gymnastId',gym);
 line:=public.dynamo_expand_event_selection(owner,item)->0;
 full_price:=(line->>'_pricePence')::bigint;
 if payment_status='Full Amount Paid' then if full_price is distinct from (p_input->>'expectedFullPence')::bigint then raise exception 'PRICE_CHANGED';end if;paid:=full_price;
 elsif payment_status='Free' then paid:=0;
 else paid:=(p_input->>'amountPence')::bigint;if paid is null or paid<1 or paid>1000000 then raise exception 'INVALID_MANUAL_PAYMENT';end if;end if;
 snapshot:=public.validate_dynamo_booking_answers(owner,line);
 selection:=line->'_selection'||jsonb_build_object('manualBooking',true,'paymentStatus',payment_status,'standardPricePence',full_price,'recordedBy',p_actor);
 -- The ordinary booking function applies all age, membership, duplicate and capacity checks.
 -- Book at zero inside this transaction, then record externally received money without touching the wallet.
 result:=public.book_dynamo_event_priced('event',(line->>'targetId')::uuid,owner,gym,false,p_operation,0,selection);
 booking:=(result->>'bookingId')::uuid;
 update public.dynamo_event_bookings set price_pence=paid,responses=snapshot->'answers',medical_snapshot=snapshot->>'medical' where id=booking returning purchase_id into purchase;
 update public.dynamo_purchases set details=details||jsonb_build_object('pricePence',paid,'manualBooking',true,'paymentStatus',payment_status,'standardPricePence',full_price,'recordedBy',p_actor) where id=purchase;
 update public.dynamo_transactions set amount_pence=paid,payment_method='external',provider_reference='manual:'||p_operation where purchase_id=purchase;
 update public.dynamo_booking_actions set actor_id=p_actor,action='manual-created',details=details||jsonb_build_object('paymentStatus',payment_status,'amountPaidPence',paid,'standardPricePence',full_price) where id=p_operation;
 result:=jsonb_build_object('ok',true,'accountId',owner,'actorId',p_actor,'bookingId',booking,'pricePence',paid,'paymentStatus',payment_status,'ticketNumber',(select ticket_number from public.dynamo_event_bookings where id=booking),'bookings',jsonb_build_array(jsonb_build_object('bookingId',booking,'pricePence',paid)));
 insert into public.dynamo_basket_checkouts(id,account_id,items,result) values(p_operation,owner,jsonb_build_array(p_input),result);
 if coalesce((p_input->>'sendConfirmation')::boolean,false) then insert into public.dynamo_confirmation_jobs(id,account_id,booking_ids) values(p_operation,owner,array[booking]);end if;
 return result;
end $$;
revoke all on function public.create_dynamo_manual_event_booking(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_dynamo_manual_event_booking(uuid,uuid,jsonb) to service_role;
commit;
