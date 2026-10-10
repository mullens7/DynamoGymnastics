-- Server-only results storage. Public reads pass through /api/results.
create table if not exists public.dynamo_results (
 id uuid primary key default gen_random_uuid(),
 details jsonb not null,
 archived boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.dynamo_results enable row level security;
revoke all on public.dynamo_results from anon, authenticated;
grant select, insert, update, delete on public.dynamo_results to service_role;
create index if not exists dynamo_results_active_created
 on public.dynamo_results (created_at desc) where archived=false;
