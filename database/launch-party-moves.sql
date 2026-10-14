CREATE OR REPLACE FUNCTION public.manage_dynamo_booking(p_kind text, p_booking uuid, p_actor uuid, p_action text, p_target uuid, p_date text, p_time text, p_operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
   select details into old_info from public.dynamo_parties where id=old_target for update;
   if p_target is null then
    if p_date is null or p_time is null or p_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'INVALID_DATE'; end if;
    select id into p_target from public.dynamo_parties where not archived and details->>'date'=p_date and details->>'time'=p_time and details->>'room'=old_info->>'room' limit 1;
   end if;
   if p_target=old_target then raise exception 'SAME_SESSION';end if;
   select details into info from public.dynamo_parties where id=p_target and not archived for update;
   if not found or info->>'status' not in ('Available','Confirmed','Pending') or info->>'room' is distinct from old_info->>'room'
    or coalesce(info->>'partyType',info->>'room') is distinct from coalesce(old_info->>'partyType',old_info->>'room')
    or ((info->>'date')||' '||(info->>'time'))::timestamp at time zone 'Europe/London'<=now() then raise exception 'SESSION_UNAVAILABLE';end if;
   if exists(select 1 from public.dynamo_party_bookings where party_id=p_target and status='Booked') then raise exception 'PARTY_SLOT_TAKEN';end if;
   if exists(select 1 from public.dynamo_parties p where p.id not in (old_target,p_target) and not p.archived
      and p.details->>'room'=info->>'room' and p.details->>'date'=info->>'date'
      and (p.details->>'status'='Blocked' or exists(select 1 from public.dynamo_party_bookings b where b.party_id=p.id and b.status='Booked'))
      and (p.details->>'time')::time<(info->>'time')::time+make_interval(mins=>public.dynamo_party_duration(old_info,old_target))
      and (info->>'time')::time<(p.details->>'time')::time+make_interval(mins=>public.dynamo_party_duration(p.details,p.id)))
    then raise exception 'PARTY_SLOT_TAKEN';end if;
   update public.dynamo_party_bookings set party_id=p_target where id=p_booking;
  end if;
 else raise exception 'INVALID_BOOKING_ACTION';end if;
 insert into public.dynamo_booking_actions(id,booking_id,kind,action,actor_id,details) values(p_operation,p_booking,p_kind,p_action,p_actor,jsonb_build_object('fromTarget',old_target,'toTarget',p_target,'destination',info,'previous',old_info));
 return jsonb_build_object('ok',true);
end;$function$;

REVOKE ALL ON FUNCTION public.manage_dynamo_booking(text,uuid,uuid,text,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_dynamo_booking(text,uuid,uuid,text,uuid,text,text,uuid) TO service_role;
