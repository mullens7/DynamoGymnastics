-- Event listings own independently bookable child sessions. Existing booking IDs survive.
do $$ declare r record; parent uuid; slug text; begin
 for r in select * from public.dynamo_events where not(details ? 'parentId') and not(details ? 'sessions') loop
 parent:=gen_random_uuid();slug:=trim(both '-' from regexp_replace(lower(r.details->>'name'),'[^a-z0-9]+','-','g'));if slug='' then slug:='event';end if;
 if exists(select 1 from public.dynamo_events where details->>'slug'=slug and not(details ? 'parentId')) then slug:=slug||'-'||left(parent::text,8);end if;
 insert into public.dynamo_events(id,details,archived) values(parent,r.details||jsonb_build_object('slug',slug,'description','','image','','sessions',jsonb_build_array(jsonb_build_object('id',r.id,'date',r.details->>'date','time',r.details->>'time','capacity',(r.details->>'capacity')::int,'label','','minAge',null,'maxAge',null))),r.archived);
 update public.dynamo_events set details=details||jsonb_build_object('parentId',parent,'slug',slug,'minAge',null,'maxAge',null,'label','') where id=r.id;
 end loop;
end $$;
create unique index if not exists dynamo_event_unique_slug on public.dynamo_events((details->>'slug')) where not(details ? 'parentId');
create or replace function public.save_dynamo_event(p_id uuid,p_details jsonb,p_archive boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare target uuid:=coalesce(p_id,gen_random_uuid()); s jsonb; old jsonb; n integer; child uuid; begin
 perform pg_advisory_xact_lock(719442004);
 if p_id is not null and not exists(select 1 from public.dynamo_events where id=target and not archived and not(details ? 'parentId')) then raise exception 'SESSION_UNAVAILABLE';end if;
 if p_archive then update public.dynamo_events set archived=true where id=target or details->>'parentId'=target::text;return jsonb_build_object('archived',true);end if;
 if exists(select 1 from public.dynamo_events where id<>target and not(details ? 'parentId') and details->>'slug'=p_details->>'slug') then raise exception 'EVENT_SLUG_TAKEN';end if;
 if exists(select 1 from public.dynamo_events e join public.dynamo_event_bookings b on b.event_id=e.id and b.status='Booked' where e.details->>'parentId'=target::text and not exists(select 1 from jsonb_array_elements(p_details->'sessions') entry where entry->>'id'=e.id::text)) then raise exception 'EVENT_SESSION_BOOKED';end if;
 for s in select value from jsonb_array_elements(p_details->'sessions') loop
 child:=(s->>'id')::uuid;select details into old from public.dynamo_events where id=child;
 if found and old->>'parentId' is distinct from target::text then raise exception 'OPERATION_CONFLICT';end if;
 select count(*) into n from public.dynamo_event_bookings where event_id=child and status='Booked';
 if n>(s->>'capacity')::integer then raise exception 'EVENT_CAPACITY_TOO_LOW';end if;
 if n>0 and (old->>'date' is distinct from s->>'date' or old->>'time' is distinct from s->>'time' or old->>'minAge' is distinct from s->>'minAge' or old->>'maxAge' is distinct from s->>'maxAge') then raise exception 'EVENT_SESSION_BOOKED';end if;
 end loop;
 insert into public.dynamo_events(id,details) values(target,p_details) on conflict(id) do update set details=excluded.details;
 update public.dynamo_events set archived=true where details->>'parentId'=target::text;
 for s in select value from jsonb_array_elements(p_details->'sessions') loop
 insert into public.dynamo_events(id,details) values((s->>'id')::uuid,(p_details-'sessions')||s||jsonb_build_object('parentId',target)) on conflict(id) do update set details=excluded.details,archived=false;
 end loop;
 return p_details||jsonb_build_object('id',target);
end $$;
create or replace function public.guard_dynamo_event_age() returns trigger language plpgsql security invoker set search_path='' as $$
declare info jsonb; dob date; years integer; begin
 if new.status<>'Booked' or (tg_op='UPDATE' and new.event_id=old.event_id and new.gymnast_id=old.gymnast_id and old.status='Booked') then return new;end if;
 select details into info from public.dynamo_events where id=new.event_id and not archived;
 if info is null or info ? 'sessions' then raise exception 'SESSION_UNAVAILABLE';end if;
 if info->>'minAge' is not null or info->>'maxAge' is not null then
 select date_of_birth into dob from public.dynamo_gymnasts where id=new.gymnast_id and account_id=new.account_id;
 if dob is null then raise exception 'AGE_INELIGIBLE';end if;
 years:=extract(year from age((info->>'date')::date,dob));
 if years<0 or years<coalesce((info->>'minAge')::int,0) or years>coalesce((info->>'maxAge')::int,1000) then raise exception 'AGE_INELIGIBLE';end if;
 end if;return new;
end $$;
drop trigger if exists dynamo_event_age on public.dynamo_event_bookings;
create trigger dynamo_event_age before insert or update on public.dynamo_event_bookings for each row execute function public.guard_dynamo_event_age();
create table if not exists public.dynamo_basket_checkouts(id uuid primary key,account_id uuid not null references public.dynamo_accounts(id),items jsonb not null,result jsonb not null,created_at timestamptz not null default now());
alter table public.dynamo_basket_checkouts enable row level security;
revoke all on public.dynamo_basket_checkouts from anon,authenticated;
grant select,insert on public.dynamo_basket_checkouts to service_role;
create index if not exists dynamo_basket_checkout_account on public.dynamo_basket_checkouts(account_id);
create or replace function public.checkout_dynamo_basket(p_account uuid,p_items jsonb,p_credit boolean,p_operation uuid,p_expected_total bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.dynamo_basket_checkouts%rowtype; item jsonb; result jsonb; results jsonb:='[]'; expected bigint:=0; price bigint; member boolean; begin
 perform pg_advisory_xact_lock(719442004);
 select * into prior from public.dynamo_basket_checkouts where id=p_operation;
 if found then if prior.account_id<>p_account or prior.items<>p_items then raise exception 'OPERATION_CONFLICT';end if;return prior.result;end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>50 then raise exception 'INVALID_BOOKING';end if;
 select roster_member into member from public.dynamo_accounts where id=p_account for update;
 for item in select value from jsonb_array_elements(p_items) loop
 if item->>'kind'='event' then select (details->>(case when member then 'memberPriceCents' else 'nonMemberPriceCents' end))::bigint into price from public.dynamo_events where id=(item->>'targetId')::uuid;else select (details->>(case when member then 'memberPriceCents' else 'nonMemberPriceCents' end))::bigint into price from public.dynamo_parties where id=(item->>'targetId')::uuid;end if;
 if price is null then raise exception 'SESSION_UNAVAILABLE';end if;expected:=expected+price;end loop;
 if p_expected_total is null or expected<>p_expected_total then raise exception 'PRICE_CHANGED';end if;
 for item in select value from jsonb_array_elements(p_items) loop
 result:=public.book_dynamo_session(item->>'kind',(item->>'targetId')::uuid,p_account,(item->>'gymnastId')::uuid,p_credit,gen_random_uuid());results:=results||jsonb_build_array(result);
 end loop;
 result:=jsonb_build_object('ok',true,'bookings',results);
 insert into public.dynamo_basket_checkouts(id,account_id,items,result) values(p_operation,p_account,p_items,result);return result;
end $$;
revoke all on function public.save_dynamo_event(uuid,jsonb,boolean),public.guard_dynamo_event_age(),public.checkout_dynamo_basket(uuid,jsonb,boolean,uuid,bigint) from public,anon,authenticated;
grant execute on function public.save_dynamo_event(uuid,jsonb,boolean),public.guard_dynamo_event_age(),public.checkout_dynamo_basket(uuid,jsonb,boolean,uuid,bigint) to service_role;
