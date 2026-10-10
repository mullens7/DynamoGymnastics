create extension if not exists btree_gist with schema extensions;
alter extension btree_gist set schema extensions;
set search_path = public, extensions;
create table if not exists public.dynamo_staff_resources (
 id uuid primary key default gen_random_uuid(),
 kind text not null check (kind in ('plan','overview','warmup')),
 title text not null check (char_length(title) between 1 and 160),
 artist text not null default '',notes text not null default '',song_url text not null default '',
 class_group text check (class_group in ('Gymini','Recreational','Both')),
 start_date date,end_date date,
 object_path text unique,file_name text,mime_type text,file_size bigint,
 state text not null check (state in ('uploading','ready')),
 archived boolean not null default false,
 created_by uuid not null references public.dynamo_accounts(id),
 created_at timestamptz not null default now(),
 check (kind<>'plan' or class_group in ('Gymini','Recreational')),
 check (kind='warmup' or (class_group is not null and start_date is not null and end_date>=start_date and object_path is not null)),
 check (object_path is null or (mime_type in ('application/pdf','video/mp4') and file_size between 12 and 52428800)),
 exclude using gist (class_group with =, daterange(start_date,end_date,'[]') with &&) where (kind='plan' and state='ready' and not archived)
);
alter table public.dynamo_staff_resources enable row level security;
revoke all on public.dynamo_staff_resources from anon,authenticated;
grant all on public.dynamo_staff_resources to service_role;
create index if not exists dynamo_staff_resources_creator_idx on public.dynamo_staff_resources(created_by,created_at);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('dynamo-staff','dynamo-staff',false,52428800,array['application/pdf','video/mp4'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
