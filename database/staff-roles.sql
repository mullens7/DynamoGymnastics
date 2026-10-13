begin;
create table if not exists public.dynamo_staff_profiles (
 account_id uuid primary key references public.dynamo_accounts(id),
 first_name text not null default '' check(char_length(first_name)<=100),
 last_name text not null default '' check(char_length(last_name)<=100),
 manual_staff boolean not null default false,
 enabled boolean not null default true,
 role text not null default 'staff' check(role in ('staff','super_admin','event_admin','check_in','party_staff','staff_planner')),
 updated_at timestamptz not null default now(),
 updated_by uuid references public.dynamo_accounts(id)
);
alter table public.dynamo_staff_profiles enable row level security;
revoke all on public.dynamo_staff_profiles from public,anon,authenticated;
grant select,insert,update on public.dynamo_staff_profiles to service_role;
insert into public.dynamo_accounts(email,owner_name)
select x||'@dynamogymnastics.co.uk',initcap(x) from unnest(array['freddie','kerri','admin','kayleigh','karen','anthony','tayah']) x on conflict(email) do nothing;
-- Seed the previously authorised website administrators once; subsequent edits remain authoritative.
insert into public.dynamo_staff_profiles(account_id,first_name,manual_staff,role)
select id,split_part(owner_name,' ',1),true,'super_admin' from public.dynamo_accounts where email in ('freddie@dynamogymnastics.co.uk','kerri@dynamogymnastics.co.uk','admin@dynamogymnastics.co.uk','kayleigh@dynamogymnastics.co.uk','karen@dynamogymnastics.co.uk','anthony@dynamogymnastics.co.uk','tayah@dynamogymnastics.co.uk') on conflict(account_id) do nothing;
alter table public.dynamo_event_bookings add column if not exists checked_in_at timestamptz;
alter table public.dynamo_event_bookings add column if not exists checked_in_by uuid references public.dynamo_accounts(id);
create index if not exists dynamo_event_bookings_checkin_actor on public.dynamo_event_bookings(checked_in_by) where checked_in_by is not null;
create index if not exists dynamo_staff_profiles_updated_by on public.dynamo_staff_profiles(updated_by) where updated_by is not null;
create or replace function public.save_dynamo_staff(p_id uuid,p_email text,p_first text,p_last text,p_role text,p_enabled boolean,p_manual boolean,p_actor uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare target uuid; prior public.dynamo_staff_profiles%rowtype;
begin
 perform pg_advisory_xact_lock(719442005);
 if not exists(select 1 from public.dynamo_staff_profiles s join public.dynamo_accounts a on a.id=s.account_id where a.id=p_actor and s.role='super_admin' and s.enabled and (s.manual_staff or a.roster_staff)) then raise exception 'STAFF_FORBIDDEN';end if;
 if p_role not in ('staff','super_admin','event_admin','check_in','party_staff','staff_planner') or p_enabled is null or length(trim(p_first)) not between 1 and 100 or length(trim(p_last)) not between 0 and 100 then raise exception 'INVALID_STAFF';end if;
 if p_id is null then
  if p_email is null or length(p_email)>254 or p_email<>lower(trim(p_email)) or p_email !~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$' then raise exception 'INVALID_STAFF';end if;
  insert into public.dynamo_accounts(email,owner_name) values(p_email,trim(p_first)||' '||trim(p_last)) on conflict(email) do nothing;
  select id into target from public.dynamo_accounts where email=p_email;
 else
  select id into target from public.dynamo_accounts where id=p_id;
  if target is null or not exists(select 1 from public.dynamo_accounts a left join public.dynamo_staff_profiles s on s.account_id=a.id where a.id=target and (a.roster_staff or s.account_id is not null)) then raise exception 'STAFF_NOT_FOUND';end if;
 end if;
 select * into prior from public.dynamo_staff_profiles where account_id=target;
 if prior.role='super_admin' and (not p_enabled or p_role<>'super_admin') and (select count(*) from public.dynamo_staff_profiles s join public.dynamo_accounts a on a.id=s.account_id where s.role='super_admin' and s.enabled and (s.manual_staff or a.roster_staff))<=1 then raise exception 'LAST_SUPER_ADMIN';end if;
 insert into public.dynamo_staff_profiles(account_id,first_name,last_name,role,enabled,manual_staff,updated_by) values(target,trim(p_first),trim(p_last),p_role,p_enabled,p_manual,p_actor)
 on conflict(account_id) do update set first_name=excluded.first_name,last_name=excluded.last_name,role=excluded.role,enabled=excluded.enabled,manual_staff=public.dynamo_staff_profiles.manual_staff or excluded.manual_staff,updated_by=p_actor,updated_at=now();
 return target;
end $$;
create or replace function public.check_in_dynamo_attendee(p_booking uuid,p_checked boolean,p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.dynamo_event_bookings%rowtype;
begin
 if p_checked is null then raise exception 'INVALID_CHECKIN';end if;
 if not exists(select 1 from public.dynamo_staff_profiles s join public.dynamo_accounts a on a.id=s.account_id where a.id=p_actor and s.enabled and (s.manual_staff or a.roster_staff) and s.role in ('super_admin','event_admin','check_in')) then raise exception 'STAFF_FORBIDDEN';end if;
 update public.dynamo_event_bookings set checked_in_at=case when p_checked then coalesce(checked_in_at,now()) else null end,checked_in_by=case when p_checked then coalesce(checked_in_by,p_actor) else null end where id=p_booking and status='Booked' returning * into result;
 if not found then raise exception 'BOOKING_NOT_FOUND';end if;
 return jsonb_build_object('id',result.id,'checkedInAt',result.checked_in_at);
end $$;
revoke all on function public.save_dynamo_staff(uuid,text,text,text,text,boolean,boolean,uuid) from public,anon,authenticated;
revoke all on function public.check_in_dynamo_attendee(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.save_dynamo_staff(uuid,text,text,text,text,boolean,boolean,uuid) to service_role;
grant execute on function public.check_in_dynamo_attendee(uuid,boolean,uuid) to service_role;
commit;
