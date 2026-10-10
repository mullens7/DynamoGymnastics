create or replace function public.manage_dynamo_party_slots(p_action text,p_slots jsonb,p_start date,p_end date,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare slot jsonb;created integer:=0;skipped integer:=0;changed integer:=0;r record;
begin
 perform pg_advisory_xact_lock(719442004);
 if p_action='create' then
  if jsonb_array_length(p_slots)>1000 then raise exception 'TOO_MANY_SLOTS';end if;
  for slot in select value from jsonb_array_elements(p_slots) loop
   if exists(select 1 from public.dynamo_parties p where not p.archived and p.details->>'status'<>'Cancelled' and p.details->>'date'=slot->>'date' and p.details->>'room'=slot->>'room' and abs(extract(epoch from ((p.details->>'time')::time-(slot->>'time')::time)))<5400) then skipped:=skipped+1;
   else insert into public.dynamo_parties(details) values(slot);created:=created+1;end if;
  end loop;
 elsif p_action in ('block','unblock') then
  for r in select p.id,p.details from public.dynamo_parties p where not p.archived and (p.details->>'date')::date between p_start and p_end for update loop
   if exists(select 1 from public.dynamo_party_bookings b where b.party_id=r.id and b.status='Booked') then skipped:=skipped+1;
   elsif p_action='block' and r.details->>'status'<>'Cancelled' then update public.dynamo_parties set details=details||jsonb_build_object('status','Blocked','blockReason',p_reason) where id=r.id;changed:=changed+1;
   elsif p_action='unblock' and r.details->>'status'='Blocked' then update public.dynamo_parties set details=(details-'blockReason')||jsonb_build_object('status','Pending') where id=r.id;changed:=changed+1;
   end if;
  end loop;
 else raise exception 'INVALID_ACTION';end if;
 return jsonb_build_object('created',created,'skipped',skipped,'changed',changed);
end;$$;
revoke all on function public.manage_dynamo_party_slots(text,jsonb,date,date,text) from public,anon,authenticated;
grant execute on function public.manage_dynamo_party_slots(text,jsonb,date,date,text) to service_role;
-- Reject blocked slots in the existing atomic booking function.
do $$
declare definition text;
begin
 select pg_get_functiondef(oid) into definition from pg_proc where proname='book_dynamo_session' and pronamespace='public'::regnamespace;
 definition:=replace(definition,'info->>''status''=''Cancelled''','info->>''status'' in (''Cancelled'',''Blocked'')');
 execute definition;
end;$$;
create or replace function public.guard_dynamo_party_block() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(719442004);
 if new.details->>'status'='Blocked' and exists(select 1 from public.dynamo_party_bookings where party_id=new.id and status='Booked') then raise exception 'Cancel the linked booking before blocking this slot.';end if;
 return new;
end;$$;
revoke all on function public.guard_dynamo_party_block() from public,anon,authenticated;
create or replace trigger guard_party_block before update of details on public.dynamo_parties for each row execute function public.guard_dynamo_party_block();
