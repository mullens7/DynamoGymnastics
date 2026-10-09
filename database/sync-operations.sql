create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create table if not exists public.dynamo_sync_jobs (
 id uuid primary key default gen_random_uuid(), source text not null check(source in ('manual','scheduled')),
 slot text unique, status text not null default 'running' check(status in ('running','complete','failed')),
 started_at timestamptz not null default now(), finished_at timestamptz,
 result jsonb, error_code text
);
create index if not exists dynamo_sync_jobs_started on public.dynamo_sync_jobs(started_at desc);
create table if not exists public.dynamo_sync_pin_limits (
 id boolean primary key default true check(id), failures integer not null default 0,
 blocked_until timestamptz
);
insert into public.dynamo_sync_pin_limits(id) values(true) on conflict(id) do nothing;
alter table public.dynamo_sync_jobs enable row level security;
alter table public.dynamo_sync_pin_limits enable row level security;
revoke all on public.dynamo_sync_jobs,public.dynamo_sync_pin_limits from anon,authenticated;
grant select,insert,update on public.dynamo_sync_jobs,public.dynamo_sync_pin_limits to service_role;
create or replace function public.check_dynamo_sync_pin(p_matches boolean) returns text
language plpgsql security invoker set search_path='' as $$
declare current public.dynamo_sync_pin_limits%rowtype;
begin
 select * into current from public.dynamo_sync_pin_limits where id=true for update;
 if current.blocked_until>now() then return 'PIN_LOCKED'; end if;
 if current.blocked_until is not null then update public.dynamo_sync_pin_limits set failures=0,blocked_until=null where id=true; current.failures:=0; end if;
 if p_matches then update public.dynamo_sync_pin_limits set failures=0,blocked_until=null where id=true; return 'OK'; end if;
 update public.dynamo_sync_pin_limits set failures=current.failures+1,blocked_until=case when current.failures+1>=5 then now()+interval '5 minutes' else null end where id=true;
 return 'PIN_INCORRECT';
end $$;
create or replace function public.claim_dynamo_sync(p_source text,p_slot text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job_id uuid;
begin
 perform pg_advisory_xact_lock(719442002);
 if p_source not in ('manual','scheduled') then raise exception 'INVALID_SOURCE'; end if;
 if p_slot is not null and exists(select 1 from public.dynamo_sync_jobs where slot=p_slot) then return jsonb_build_object('state','duplicate'); end if;
 update public.dynamo_sync_jobs set status='failed',finished_at=now(),error_code='SESSION_TIMEOUT' where status='running' and started_at<now()-interval '3 minutes';
 if exists(select 1 from public.dynamo_sync_jobs where status='running') then return jsonb_build_object('state','busy'); end if;
 insert into public.dynamo_sync_jobs(source,slot) values(p_source,p_slot) returning id into job_id;
 return jsonb_build_object('state','claimed','id',job_id);
end $$;
revoke all on function public.check_dynamo_sync_pin(boolean),public.claim_dynamo_sync(text,text) from public,anon,authenticated;
grant execute on function public.check_dynamo_sync_pin(boolean),public.claim_dynamo_sync(text,text) to service_role;
-- The hourly dispatcher checks London local time; BST/GMT changes require no edits.
create or replace function public.dispatch_dynamo_scheduled_sync() returns bigint
language plpgsql security definer set search_path='' as $$
declare local_time timestamp; token text;
begin
 local_time:=now() at time zone 'Europe/London';
 if extract(hour from local_time) not in (0,12) then return null; end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='dynamo_sync_schedule_secret';
 if token is null then raise exception 'SCHEDULE_NOT_CONFIGURED'; end if;
 return net.http_post(
  url:='https://dynamo-gymnastics.vercel.app/api/scheduled-sync/',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
  body:='{}'::jsonb,timeout_milliseconds:=150000
 );
end $$;
revoke all on function public.dispatch_dynamo_scheduled_sync() from public,anon,authenticated,service_role;
select cron.schedule('dynamo-members-uk-midnight-noon','0 * * * *','select public.dispatch_dynamo_scheduled_sync();');
-- Do not expose HTTP headers containing the scheduler-only token through the Data API.
revoke select on net.http_request_queue,net._http_response from public,anon,authenticated;
