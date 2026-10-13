begin;
alter table public.dynamo_gymnasts add column if not exists medical_details text;
alter table public.dynamo_event_bookings add column if not exists responses jsonb not null default '[]';
alter table public.dynamo_event_bookings add column if not exists medical_snapshot text;
alter table public.dynamo_party_bookings add column if not exists medical_snapshot text;
create table public.dynamo_booking_field_templates(id uuid primary key default gen_random_uuid(),details jsonb not null,archived boolean not null default false,created_at timestamptz not null default now());
alter table public.dynamo_booking_field_templates enable row level security;
revoke all on public.dynamo_booking_field_templates from public,anon,authenticated;
grant select,insert,update on public.dynamo_booking_field_templates to service_role;
insert into public.dynamo_booking_field_templates(details) values
('{"label":"I understand that this is a parent-led fun session, and I am to attend with my child/children","type":"acknowledgement","required":true,"options":[]}'),
('{"label":"I confirm that I will acknowledge the parking signs at The Hamble Sports Complex, and failure to put your Vehicle Registration in, will result in a PCN.","type":"acknowledgement","required":true,"options":[]}'),
('{"label":"Emergency contact number","type":"phone","required":true,"options":[]}');
create function public.validate_dynamo_booking_answers(p_account uuid,p_item jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare medical text; fields jsonb:='[]'; f jsonb; val jsonb; answers jsonb:=coalesce(p_item->'answers','{}'); snapshot jsonb:='[]'; textval text;
begin
 select medical_details into medical from public.dynamo_gymnasts where id=(p_item->>'gymnastId')::uuid and account_id=p_account for update;
 if not found then raise exception 'GYMNAST_NOT_FOUND';end if;
 if medical is null then
  if p_item->'medicalNone'='true'::jsonb then medical:='None';else medical:=trim(p_item->>'medicalDetails');end if;
  if medical is null or length(medical)<1 or length(medical)>5000 then raise exception 'MEDICAL_REQUIRED';end if;
  update public.dynamo_gymnasts set medical_details=medical where id=(p_item->>'gymnastId')::uuid and account_id=p_account;
 end if;
 if p_item->>'kind'='event' then select coalesce(details->'bookingFields','[]') into fields from public.dynamo_events where id=(p_item->>'targetId')::uuid and not archived;
 if fields is null then raise exception 'SESSION_UNAVAILABLE';end if;
 if fields<>coalesce(p_item->'fieldDefinitions','[]') then raise exception 'BOOKING_FIELDS_CHANGED';end if;
 end if;
 if jsonb_typeof(answers)<>'object' then raise exception 'BOOKING_DATA_REQUIRED';end if;
 for f in select value from jsonb_array_elements(fields) loop
 val:=answers->(f->>'id');textval:=case when jsonb_typeof(val)='string' then trim(val#>>'{}') else null end;
 if f->>'type'='acknowledgement' then if val is distinct from 'true'::jsonb then raise exception 'BOOKING_DATA_REQUIRED';end if;
 elsif coalesce((f->>'required')::boolean,false) and (val is null or val='null'::jsonb or val='""'::jsonb or val='[]'::jsonb) then raise exception 'BOOKING_DATA_REQUIRED';
 end if;
 if val is not null and val<>'null'::jsonb and val<>'""'::jsonb and val<>'[]'::jsonb then
 case f->>'type'
 when 'short_text' then if textval is null or length(textval) not between 1 and 500 then raise exception 'BOOKING_DATA_REQUIRED';end if;
 when 'long_text' then if textval is null or length(textval) not between 1 and 5000 then raise exception 'BOOKING_DATA_REQUIRED';end if;
 when 'phone' then if textval is null or textval !~ '^[+0-9 ()-]{6,25}$' then raise exception 'BOOKING_DATA_REQUIRED';end if;
 when 'date' then if textval is null or textval !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'BOOKING_DATA_REQUIRED';end if;begin perform textval::date;exception when others then raise exception 'BOOKING_DATA_REQUIRED';end;
 when 'dropdown' then if textval is null or not (f->'options' @> jsonb_build_array(textval)) then raise exception 'BOOKING_DATA_REQUIRED';end if;
 when 'multiselect' then if jsonb_typeof(val)<>'array' or not (f->'options' @> val) or jsonb_array_length(val)>100 then raise exception 'BOOKING_DATA_REQUIRED';end if;
 when 'acknowledgement' then null;
 else raise exception 'BOOKING_DATA_REQUIRED';end case;
 end if;
 snapshot:=snapshot||jsonb_build_array(jsonb_build_object('id',f->>'id','label',f->>'label','type',f->>'type','value',val));
 end loop;
 return jsonb_build_object('medical',medical,'answers',snapshot);
end $$;
revoke all on function public.validate_dynamo_booking_answers(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.validate_dynamo_booking_answers(uuid,jsonb) to service_role;
do $$ declare def text;begin
 select pg_get_functiondef(oid) into def from pg_proc where proname='checkout_dynamo_basket';
 def:=replace(def,'member boolean; begin','member boolean; snapshot jsonb; begin');
 def:=replace(def,'for item in select value from jsonb_array_elements(p_items) loop'||chr(10)||' if item', 'for item in select value from jsonb_array_elements(p_items) loop'||chr(10)||' if item');
 def:=replace(def,'if item->>''kind''=''party'' then result:=','snapshot:=public.validate_dynamo_booking_answers(p_account,item); if item->>''kind''=''party'' then result:=');
 def:=replace(def,'results:=results||jsonb_build_array(result);','results:=results||jsonb_build_array(result); if item->>''kind''=''event'' then update public.dynamo_event_bookings set responses=snapshot->''answers'',medical_snapshot=snapshot->>''medical'' where id=(result->>''bookingId'')::uuid;else update public.dynamo_party_bookings set medical_snapshot=snapshot->>''medical'' where id=(result->>''bookingId'')::uuid;end if;');
 if position('snapshot:=public.validate_dynamo_booking_answers' in def)=0 then raise exception 'Checkout patch failed';end if;execute def;
end $$;
commit;
