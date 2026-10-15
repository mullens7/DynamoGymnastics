begin;
create table public.dynamo_support_sessions (
 id uuid primary key default gen_random_uuid(),token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),actor_session_hash text not null check(actor_session_hash ~ '^[a-f0-9]{64}$'),actor_id uuid not null references public.dynamo_accounts(id),target_id uuid not null references public.dynamo_accounts(id),reason text not null check(length(reason) between 3 and 300),started_at timestamptz not null default now(),expires_at timestamptz not null,ended_at timestamptz,check(actor_id<>target_id),check(expires_at>started_at)
);
create index dynamo_support_actor on public.dynamo_support_sessions(actor_id,started_at desc);
create table public.dynamo_support_audit (
 id uuid primary key default gen_random_uuid(),session_id uuid not null references public.dynamo_support_sessions(id),actor_id uuid not null references public.dynamo_accounts(id),target_id uuid not null references public.dynamo_accounts(id),action text not null,created_at timestamptz not null default now()
);
create index dynamo_support_audit_time on public.dynamo_support_audit(created_at desc);
alter table public.dynamo_support_sessions enable row level security;
alter table public.dynamo_support_audit enable row level security;
revoke all on public.dynamo_support_sessions,public.dynamo_support_audit from public,anon,authenticated;
grant select,insert,update on public.dynamo_support_sessions to service_role;
grant select,insert on public.dynamo_support_audit to service_role;
commit;
