create table public.dynamo_internal_events (
 id uuid primary key default gen_random_uuid(),
 details jsonb not null,
 archived boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.dynamo_internal_events enable row level security;
revoke all on public.dynamo_internal_events from public,anon,authenticated;
grant select,insert,update on public.dynamo_internal_events to service_role;
