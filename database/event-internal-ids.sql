begin;
alter table public.dynamo_events add column if not exists internal_id text;
create unique index if not exists dynamo_events_internal_id_unique on public.dynamo_events(internal_id);
create or replace function public.assign_dynamo_event_internal_id() returns trigger
language plpgsql security invoker set search_path='' as $$
declare candidate text; existing text; attempts integer:=0;
begin
 if TG_OP='UPDATE' and OLD.internal_id is not null then NEW.internal_id:=OLD.internal_id;return NEW;end if;
 perform pg_advisory_xact_lock(719442004);
 select internal_id into existing from public.dynamo_events where id=NEW.id;
 if existing is not null then NEW.internal_id:=existing;return NEW;end if;
 loop
  candidate:=substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ',1+floor(random()*26)::integer,1)
   ||floor(random()*10)::integer::text
   ||substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ',1+floor(random()*26)::integer,1)
   ||floor(random()*10)::integer::text;
  exit when not exists(select 1 from public.dynamo_events where internal_id=candidate);
  attempts:=attempts+1;
  if attempts>10000 then raise exception 'EVENT_ID_SPACE_EXHAUSTED';end if;
 end loop;
 NEW.internal_id:=candidate;return NEW;
end $$;
revoke all on function public.assign_dynamo_event_internal_id() from public,anon,authenticated;
grant execute on function public.assign_dynamo_event_internal_id() to service_role;
drop trigger if exists dynamo_event_internal_id on public.dynamo_events;
create trigger dynamo_event_internal_id before insert or update on public.dynamo_events
for each row execute function public.assign_dynamo_event_internal_id();
update public.dynamo_events set internal_id=null where internal_id is null;
alter table public.dynamo_events alter column internal_id set not null;
alter table public.dynamo_events add constraint dynamo_events_internal_id_format check(internal_id ~ '^[A-Z][0-9][A-Z][0-9]$');
notify pgrst,'reload schema';
commit;
