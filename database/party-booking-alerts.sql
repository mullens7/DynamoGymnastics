begin;
alter table public.dynamo_party_bookings add column party_details jsonb not null default '{}';
create table public.dynamo_party_alerts(booking_id uuid primary key references public.dynamo_party_bookings(id) on delete cascade,status text not null default 'pending' check(status in ('pending','sending','sent','review','skipped')),created_at timestamptz not null default now(),attempted_at timestamptz,sent_at timestamptz,error_code text);
alter table public.dynamo_party_alerts enable row level security;
revoke all on public.dynamo_party_alerts from public,anon,authenticated;
grant select,insert,update,delete on public.dynamo_party_alerts to service_role;
create function public.queue_dynamo_party_alert() returns trigger language plpgsql security invoker set search_path='' as $$begin if new.status='Booked' then insert into public.dynamo_party_alerts(booking_id) values(new.id) on conflict do nothing;end if;return new;end $$;
revoke all on function public.queue_dynamo_party_alert() from public,anon,authenticated;
grant execute on function public.queue_dynamo_party_alert() to service_role;
create trigger queue_dynamo_party_alert after insert on public.dynamo_party_bookings for each row execute function public.queue_dynamo_party_alert();
-- New successful checkouts must capture print-sheet data before the party is confirmed.
create function public.validate_dynamo_party_details(p_target uuid,p_item jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg jsonb;info jsonb;contact text:=trim(p_item->'partyDetails'->>'contactNumber');children integer;limit_children integer;
begin
 select details into info from public.dynamo_parties where id=p_target and not archived;
 select details into cfg from public.dynamo_party_types where id=coalesce(info->>'partyType',case when info->>'room'='Small gym' then 'preschool' else 'dynamo' end);
 limit_children:=coalesce((cfg->>'guests')::integer,(info->>'guests')::integer,1000);
 if contact is null or contact !~ '^[+0-9 ()-]{6,25}$' or coalesce(p_item->'partyDetails'->>'numberOfChildren','') !~ '^[0-9]{1,4}$' then raise exception 'PARTY_DETAILS_REQUIRED';end if;
 children:=(p_item->'partyDetails'->>'numberOfChildren')::integer;if children<1 or children>limit_children then raise exception 'PARTY_CHILD_COUNT';end if;
 return jsonb_build_object('contactNumber',contact,'numberOfChildren',children);
end $$;
revoke all on function public.validate_dynamo_party_details(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.validate_dynamo_party_details(uuid,jsonb) to service_role;
do $$declare def text;begin
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='checkout_dynamo_basket';
 def:=replace(def,'snapshot:=public.validate_dynamo_booking_answers(p_account,item);','snapshot:=public.validate_dynamo_booking_answers(p_account,item);if item->>''kind''=''party'' then perform public.validate_dynamo_party_details((item->>''targetId'')::uuid,item);end if;');
 def:=replace(def,'set medical_snapshot=snapshot->>''medical'' where id=(result->>''bookingId'')::uuid','set medical_snapshot=snapshot->>''medical'',party_details=public.validate_dynamo_party_details((item->>''targetId'')::uuid,item) where id=(result->>''bookingId'')::uuid');
 if position('party_details=public.validate_dynamo_party_details' in def)=0 then raise exception 'Party detail patch failed';end if;execute def;
end $$;
-- Protect deletion while the administrator's print-sheet email is actively being sent.
do $$declare def text;begin
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='erase_dynamo_contact_history';
 def:=replace(def,'selected_booking_ids:=event_rows||party_rows;','selected_booking_ids:=event_rows||party_rows;if exists(select 1 from public.dynamo_party_alerts where booking_id=any(party_rows) and status=''sending'') then raise exception ''HISTORY_BUSY'';end if;');execute def;
end $$;
commit;
