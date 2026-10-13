alter table public.dynamo_staff_profiles add column if not exists roles text[];
update public.dynamo_staff_profiles set roles=array[role] where roles is null;
alter table public.dynamo_staff_profiles add constraint dynamo_staff_roles_valid check(roles is null or (cardinality(roles)>0 and cardinality(roles)<=6 and roles <@ array['staff','super_admin','event_admin','check_in','party_staff','staff_planner']::text[]));
create or replace function public.save_dynamo_staff_roles(p_id uuid,p_email text,p_first text,p_last text,p_roles text[],p_enabled boolean,p_manual boolean,p_actor uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare target uuid;primary_role text;
begin
 if p_roles is null or cardinality(p_roles)<1 or cardinality(p_roles)>6 or not(p_roles <@ array['staff','super_admin','event_admin','check_in','party_staff','staff_planner']::text[]) then raise exception 'INVALID_STAFF';end if;
 primary_role:=case when 'super_admin'=any(p_roles) then 'super_admin' when 'event_admin'=any(p_roles) then 'event_admin' when 'check_in'=any(p_roles) then 'check_in' else p_roles[1] end;
 target:=public.save_dynamo_staff(p_id,p_email,p_first,p_last,primary_role,p_enabled,p_manual,p_actor);
 update public.dynamo_staff_profiles set roles=p_roles where account_id=target;
 return target;
end $$;
revoke all on function public.save_dynamo_staff_roles(uuid,text,text,text,text[],boolean,boolean,uuid) from public,anon,authenticated;
grant execute on function public.save_dynamo_staff_roles(uuid,text,text,text,text[],boolean,boolean,uuid) to service_role;
