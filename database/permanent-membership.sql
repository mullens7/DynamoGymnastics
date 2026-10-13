alter table public.dynamo_accounts add column if not exists manual_member boolean not null default false;
alter table public.dynamo_accounts add column if not exists manual_member_since timestamptz;
alter table public.dynamo_accounts add column if not exists manual_member_by uuid;
create or replace function public.preserve_dynamo_permanent_member() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.manual_member and not new.manual_member then raise exception 'PERMANENT_MEMBERSHIP';end if;
 if new.manual_member then new.roster_member:=true;new.manual_member_since:=coalesce(case when tg_op='UPDATE' then old.manual_member_since else null end,new.manual_member_since,now());if tg_op='UPDATE' and old.manual_member then new.manual_member_by:=old.manual_member_by;end if;end if;
 return new;
end $$;
create trigger dynamo_permanent_member_guard before insert or update on public.dynamo_accounts for each row execute function public.preserve_dynamo_permanent_member();
revoke all on function public.preserve_dynamo_permanent_member() from public,anon,authenticated;
