create table if not exists public.dynamo_events (
 id uuid primary key default gen_random_uuid(), details jsonb not null,
 archived boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.dynamo_parties (
 id uuid primary key default gen_random_uuid(), details jsonb not null,
 archived boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.dynamo_event_bookings (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.dynamo_events(id),
 account_id uuid not null references public.dynamo_accounts(id), gymnast_id uuid references public.dynamo_gymnasts(id),
 status text not null default 'Booked' check(status in ('Booked','Cancelled')),
 created_at timestamptz not null default now()
);
create index if not exists dynamo_event_bookings_event on public.dynamo_event_bookings(event_id);
create index if not exists dynamo_event_bookings_account on public.dynamo_event_bookings(account_id);
create index if not exists dynamo_event_bookings_gymnast on public.dynamo_event_bookings(gymnast_id);
alter table public.dynamo_events enable row level security;
alter table public.dynamo_parties enable row level security;
alter table public.dynamo_event_bookings enable row level security;
revoke all on public.dynamo_events,public.dynamo_parties,public.dynamo_event_bookings from anon,authenticated;
grant select,insert,update on public.dynamo_events,public.dynamo_parties to service_role;
grant select on public.dynamo_event_bookings,public.dynamo_transactions,public.dynamo_purchases to service_role;
