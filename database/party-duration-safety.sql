create or replace function public.dynamo_party_duration(p_info jsonb,p_id uuid) returns integer language plpgsql security invoker set search_path='' as $$
declare duration integer;begin
 if p_id is not null then select (purchase.details->>'activityMinutes')::integer into duration from public.dynamo_party_bookings b join public.dynamo_purchases purchase on purchase.id=b.purchase_id where b.party_id=p_id and b.status='Booked' limit 1;end if;
 if duration is null then select (details->>'activityMinutes')::integer into duration from public.dynamo_party_types where id=coalesce(p_info->>'partyType',case when p_info->>'room'='Small gym' then 'preschool' else 'dynamo' end);end if;
 return coalesce(duration,(p_info->>'activityMinutes')::integer,60);
end;$$;
revoke all on function public.dynamo_party_duration(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.dynamo_party_duration(jsonb,uuid) to service_role;
do $$declare def text;begin
 select pg_get_functiondef('public.manage_dynamo_party_slots(text,jsonb,date,date,text)'::regprocedure) into def;
 def:=replace(def,'abs(extract(epoch from ((p.details->>''time'')::time-(slot->>''time'')::time)))<3600','(p.details->>''time'')::time<(slot->>''time'')::time+make_interval(mins=>public.dynamo_party_duration(slot,null)) and (slot->>''time'')::time<(p.details->>''time'')::time+make_interval(mins=>public.dynamo_party_duration(p.details,p.id))');execute def;
 select pg_get_functiondef('public.manage_dynamo_booking(text,uuid,uuid,text,uuid,text,text,uuid)'::regprocedure) into def;
 def:=replace(def,'abs(extract(epoch from ((p.details->>''time'')::time-p_time::time)))<3600','(p.details->>''time'')::time<p_time::time+make_interval(mins=>public.dynamo_party_duration(old_info,old_target)) and p_time::time<(p.details->>''time'')::time+make_interval(mins=>public.dynamo_party_duration(p.details,p.id))');execute def;
 select pg_get_functiondef('public.dynamo_party_price(uuid,boolean,boolean)'::regprocedure) into def;
 def:=replace(def,'price:=(cfg->>', 'if exists(select 1 from public.dynamo_parties p join public.dynamo_party_bookings b on b.party_id=p.id and b.status=''Booked'' where p.id<>p_target and p.details->>''room''=info->>''room'' and p.details->>''date''=info->>''date'' and (p.details->>''time'')::time<(info->>''time'')::time+make_interval(mins=>(cfg->>''activityMinutes'')::int) and (info->>''time'')::time<(p.details->>''time'')::time+make_interval(mins=>public.dynamo_party_duration(p.details,p.id))) then raise exception ''SESSION_UNAVAILABLE'';end if; price:=(cfg->>');execute def;
end $$;
