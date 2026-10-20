begin;
-- Server-only, atomic completion of missing visible answers and session check-in.
create or replace function public.complete_dynamo_event_checkin(p_booking uuid,p_session uuid,p_checked boolean,p_actor uuid,p_answers jsonb default '{}',p_medical text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.dynamo_event_bookings%rowtype; info jsonb; f jsonb; saved jsonb; val jsonb; textval text; fields jsonb:='[]'; additions jsonb:='[]'; missing jsonb:='[]'; medical text; needs_medical boolean; was_checked boolean; result jsonb;begin
 if p_checked is null or p_session is null or jsonb_typeof(coalesce(p_answers,'{}'))<>'object' or length(coalesce(p_answers,'{}')::text)>100000 then raise exception 'INVALID_CHECKIN';end if;
 if not exists(select 1 from public.dynamo_accounts a left join public.dynamo_staff_profiles s on s.account_id=a.id where a.id=p_actor and (a.email='freddie@mullens.com' or s.enabled and (s.manual_staff or a.roster_staff) and coalesce(s.roles,array[s.role]) && array['super_admin','event_admin','check_in']::text[])) then raise exception 'STAFF_FORBIDDEN';end if;
 perform pg_advisory_xact_lock(719442004);
 select * into b from public.dynamo_event_bookings where id=p_booking for update;
 if not found or b.event_id<>p_session or b.status<>'Booked' then raise exception 'BOOKING_NOT_FOUND';end if;
 if b.payment_pending then raise exception 'PAYMENT_PENDING';end if;
 was_checked:=b.checked_in_at is not null;
 if not p_checked then update public.dynamo_event_bookings set checked_in_at=null,checked_in_by=null where id=b.id;return jsonb_build_object('id',b.id,'checkedInAt',null);end if;
 select details into info from public.dynamo_events where id=b.event_id;
 select medical_details into medical from public.dynamo_gymnasts where id=b.gymnast_id for update;
 medical:=coalesce(nullif(trim(medical),''),nullif(trim(b.medical_snapshot),''));needs_medical:=medical is null;
 for f in select value from jsonb_array_elements(coalesce(info->'bookingFields','[]')) where value->'checkInVisible'='true'::jsonb loop
 select value into saved from jsonb_array_elements(coalesce(b.responses,'[]')) where value->>'id'=f->>'id' and value->>'type'=f->>'type' limit 1;
 if saved is null and b.selection->>'legacyImport'='true' then
 select value into saved from jsonb_array_elements(b.responses) where value->>'id' like 'legacy-%' and value->>'label'=f->>'label' and value->>'type'=f->>'type' limit 1;
 end if;
 val:=saved->'value';
 if val is not null and val<>'null'::jsonb and val<>'[]'::jsonb and val<>'false'::jsonb and (jsonb_typeof(val)<>'string' or length(trim(val#>>'{}'))>0) then continue;end if;
 missing:=missing||jsonb_build_array(jsonb_build_object('id',f->>'id','label',f->>'label','type',f->>'type','options',coalesce(f->'options','[]'),'required',true));
 end loop;
 if exists(select 1 from jsonb_object_keys(coalesce(p_answers,'{}')) k where not exists(select 1 from jsonb_array_elements(missing) q where q->>'id'=k) and not exists(select 1 from jsonb_array_elements(coalesce(info->'bookingFields','[]')) fd join jsonb_array_elements(coalesce(b.responses,'[]')) a on a->>'id'=fd->>'id' and a->>'type'=fd->>'type' where fd->>'id'=k and fd->'checkInVisible'='true'::jsonb and a->'value'=p_answers->k)) then raise exception 'CHECKIN_DETAILS_CHANGED';end if;
 if exists(select 1 from jsonb_array_elements(missing) q where not coalesce(p_answers,'{}') ? (q->>'id')) or needs_medical and nullif(trim(p_medical),'') is null then
 return jsonb_build_object('needsDetails',true,'bookingId',b.id,'eventId',b.event_id,'fields',missing,'needsMedical',needs_medical,'gymnastName',(select trim(first_name||' '||last_name) from public.dynamo_gymnasts where id=b.gymnast_id));end if;
 for f in select value from jsonb_array_elements(missing) loop
 val:=p_answers->(f->>'id');textval:=case when jsonb_typeof(val)='string' then trim(val#>>'{}') else null end;
 case f->>'type'
 when 'acknowledgement' then if val is distinct from 'true'::jsonb then raise exception 'CHECKIN_DETAILS_INVALID';end if;
 when 'short_text' then if textval is null or length(textval) not between 1 and 500 then raise exception 'CHECKIN_DETAILS_INVALID';end if;
 when 'long_text' then if textval is null or length(textval) not between 1 and 5000 then raise exception 'CHECKIN_DETAILS_INVALID';end if;
 when 'phone' then if textval is null or textval !~ '^[+0-9 ()-]{6,25}$' or length(regexp_replace(textval,'[^0-9]','','g'))<6 then raise exception 'CHECKIN_DETAILS_INVALID';end if;
 when 'date' then if textval is null or textval !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'CHECKIN_DETAILS_INVALID';end if;begin perform textval::date;exception when others then raise exception 'CHECKIN_DETAILS_INVALID';end;
 when 'dropdown' then if textval is null or not (f->'options' @> jsonb_build_array(textval)) then raise exception 'CHECKIN_DETAILS_INVALID';end if;
 when 'multiselect' then if jsonb_typeof(val) is distinct from 'array' then raise exception 'CHECKIN_DETAILS_INVALID';end if;if jsonb_array_length(val)=0 or jsonb_array_length(val)>100 or not (f->'options' @> val) then raise exception 'CHECKIN_DETAILS_INVALID';end if;
 else raise exception 'CHECKIN_DETAILS_INVALID';end case;
 if textval is not null then val:=to_jsonb(textval);end if;
 additions:=additions||jsonb_build_array(jsonb_build_object('id',f->>'id','label',f->>'label','type',f->>'type','value',val,'collectedAt',now(),'collectedBy',p_actor,'collectedAtCheckIn',true));
 end loop;
 if needs_medical then
 medical:=trim(p_medical);if length(medical) not between 1 and 5000 then raise exception 'CHECKIN_DETAILS_INVALID';end if;
 update public.dynamo_gymnasts set medical_details=medical where id=b.gymnast_id and nullif(trim(medical_details),'') is null;
 end if;
 select coalesce(jsonb_agg(a),'[]') into result from jsonb_array_elements(coalesce(b.responses,'[]')) a where not exists(select 1 from jsonb_array_elements(additions) n where n->>'id'=a->>'id');
 update public.dynamo_event_bookings set responses=result||additions,medical_snapshot=coalesce(nullif(trim(medical_snapshot),''),medical),checked_in_at=coalesce(checked_in_at,now()),checked_in_by=coalesce(checked_in_by,p_actor) where id=b.id returning checked_in_at into b.checked_in_at;
 return jsonb_build_object('id',b.id,'checkedInAt',b.checked_in_at,'alreadyCheckedIn',was_checked);
end $$;
revoke all on function public.complete_dynamo_event_checkin(uuid,uuid,boolean,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.complete_dynamo_event_checkin(uuid,uuid,boolean,uuid,jsonb,text) to service_role;
-- Keep the legacy server entry point subject to the same missing-detail rules.
create or replace function public.check_in_dynamo_attendee(p_booking uuid,p_checked boolean,p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare session_id uuid;begin
 select event_id into session_id from public.dynamo_event_bookings where id=p_booking;
 if session_id is null then raise exception 'BOOKING_NOT_FOUND';end if;
 return public.complete_dynamo_event_checkin(p_booking,session_id,p_checked,p_actor,'{}',null);
end $$;
revoke all on function public.check_in_dynamo_attendee(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.check_in_dynamo_attendee(uuid,boolean,uuid) to service_role;
commit;
