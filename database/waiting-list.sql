-- Durable, server-only waiting-list receipts. No customer/auth account is created.
create table if not exists public.dynamo_waiting_list_submissions (
 id uuid primary key,
 fingerprint text not null check(length(fingerprint)=64),
 details jsonb not null,
 created_at timestamptz not null default now(),
 state text not null default 'processing' check(state in ('processing','sheeted','attention')),
 email_status text not null default 'pending' check(email_status in ('pending','sending','sent','attention')),
 sheeted_at timestamptz,
 email_sent_at timestamptz,
 error_code text
);
create index if not exists dynamo_waiting_fingerprint on public.dynamo_waiting_list_submissions(fingerprint,created_at desc);
alter table public.dynamo_waiting_list_submissions enable row level security;
revoke all on public.dynamo_waiting_list_submissions from public,anon,authenticated;
grant select,insert,update on public.dynamo_waiting_list_submissions to service_role;
create or replace function public.reserve_dynamo_waiting_list(p_id uuid,p_hash text,p_details jsonb,p_limit text,p_email_limit text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare existing public.dynamo_waiting_list_submissions;
begin
 if p_id is null or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_details->'children') is distinct from 'array' then raise exception 'INVALID_SUBMISSION'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_hash,719450));
 select * into existing from public.dynamo_waiting_list_submissions where id=p_id;
 if found then
  if existing.fingerprint<>p_hash then raise exception 'SUBMISSION_CHANGED'; end if;
  return jsonb_build_object('record',to_jsonb(existing),'fresh',false);
 end if;
 select * into existing from public.dynamo_waiting_list_submissions where fingerprint=p_hash and created_at>now()-interval '24 hours' order by created_at desc limit 1;
 if found then return jsonb_build_object('record',to_jsonb(existing),'fresh',false);end if;
 if not public.limit_dynamo_contact(p_limit) or not public.limit_dynamo_contact(p_email_limit) then raise exception 'WAITING_RATE_LIMIT';end if;
 insert into public.dynamo_waiting_list_submissions(id,fingerprint,details) values(p_id,p_hash,p_details) returning * into existing;
 return jsonb_build_object('record',to_jsonb(existing),'fresh',true);
end;
$$;
revoke all on function public.reserve_dynamo_waiting_list(uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.reserve_dynamo_waiting_list(uuid,text,jsonb,text,text) to service_role;
