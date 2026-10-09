-- Apply once to a dedicated Dynamo Supabase project. No emails/auth users created.
begin;
create table if not exists public.dynamo_accounts (
 id uuid primary key default gen_random_uuid(),
 email text not null unique check(email=lower(trim(email))),
 owner_name text not null default '',
 auth_user_id uuid unique references auth.users(id) on delete set null,
 roster_member boolean not null default false,
 roster_staff boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.dynamo_gymnasts (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.dynamo_accounts(id),
 source_id text not null unique,
 first_name text not null, last_name text not null,
 date_of_birth text, bg_number text not null default '',
 groups text[] not null default '{}', active boolean not null default false
);
create index if not exists dynamo_gymnasts_account on public.dynamo_gymnasts(account_id);
create table if not exists public.dynamo_purchases (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.dynamo_accounts(id),
 created_at timestamptz not null default now(), details jsonb not null default '{}'
);
create index if not exists dynamo_purchases_account on public.dynamo_purchases(account_id);
create table if not exists public.dynamo_transactions (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.dynamo_accounts(id),
 purchase_id uuid references public.dynamo_purchases(id),
 amount_pence bigint not null check(amount_pence>=0),
 status text not null check(status in ('successful','declined','pending','refunded')),
 created_at timestamptz not null default now()
);
create index if not exists dynamo_transactions_account on public.dynamo_transactions(account_id);
create index if not exists dynamo_transactions_purchase on public.dynamo_transactions(purchase_id);
create table if not exists public.dynamo_roster_runs (
 id uuid primary key default gen_random_uuid(), snapshot_hash text not null unique,
 started_at timestamptz not null, completed_at timestamptz not null default now(),
 accounts integer not null, members integer not null, staff integer not null, gymnasts integer not null
);
alter table public.dynamo_accounts enable row level security;
alter table public.dynamo_gymnasts enable row level security;
alter table public.dynamo_purchases enable row level security;
alter table public.dynamo_transactions enable row level security;
alter table public.dynamo_roster_runs enable row level security;
revoke all on public.dynamo_accounts,public.dynamo_gymnasts,public.dynamo_purchases,public.dynamo_transactions,public.dynamo_roster_runs from anon,authenticated;
grant select,insert,update on public.dynamo_accounts,public.dynamo_gymnasts,public.dynamo_roster_runs to service_role;
-- The importer has no DELETE action and no write path to purchases/transactions.
create or replace function public.apply_dynamo_roster(p_hash text,p_started_at timestamptz,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.dynamo_roster_runs%rowtype; same public.dynamo_roster_runs%rowtype;
 n_accounts integer; n_members integer; n_staff integer; n_gymnasts integer;
 owner jsonb; gymnast jsonb; account_uuid uuid; existing_owner uuid; manual_profile uuid; manual_matches integer;
begin
 perform pg_advisory_xact_lock(719442001);
 if p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'SNAPSHOT_REVIEW_REQUIRED'; end if;
 select * into same from public.dynamo_roster_runs order by started_at desc limit 1;
 if found and same.snapshot_hash=p_hash then return jsonb_build_object('unchanged',true,'accounts',same.accounts,'members',same.members,'staff',same.staff); end if;
 select count(*),count(*) filter(where (x->>'member')::boolean),count(*) filter(where (x->>'staff')::boolean),coalesce(sum(jsonb_array_length(x->'gymnasts')),0)
 into n_accounts,n_members,n_staff,n_gymnasts from jsonb_array_elements(p_rows) x;
 select * into previous from public.dynamo_roster_runs order by started_at desc limit 1;
 if found then
  if p_started_at<=previous.started_at then raise exception 'STALE_SNAPSHOT'; end if;
  if n_accounts<previous.accounts*0.75 or n_members<previous.members*0.75 or n_gymnasts<previous.gymnasts*0.75 then raise exception 'SNAPSHOT_REVIEW_REQUIRED'; end if;
 end if;
 update public.dynamo_accounts set roster_member=false,roster_staff=false where roster_member or roster_staff;
 update public.dynamo_gymnasts set active=false where active;
 for owner in select value from jsonb_array_elements(p_rows) loop
  insert into public.dynamo_accounts(email,owner_name,roster_member,roster_staff)
  values(owner->>'email',coalesce(owner->>'ownerName',''),(owner->>'member')::boolean,(owner->>'staff')::boolean)
  on conflict(email) do update set owner_name=excluded.owner_name,roster_member=excluded.roster_member,roster_staff=excluded.roster_staff
  returning id into account_uuid;
  for gymnast in select value from jsonb_array_elements(owner->'gymnasts') loop
   select account_id into existing_owner from public.dynamo_gymnasts where source_id=gymnast->>'sourceId';
   if found and existing_owner<>account_uuid then raise exception 'IDENTITY_REVIEW_REQUIRED'; end if;
   if not found and gymnast->>'sourceId' like 'derived:%' then
    -- A corrected name/DOB or changed owner must not silently create a new profile.
    if exists(
     select 1 from public.dynamo_gymnasts old
     where old.source_id like 'derived:%'
      and not exists(select 1 from jsonb_array_elements(p_rows) a cross join lateral jsonb_array_elements(a->'gymnasts') g where g->>'sourceId'=old.source_id)
      and (
       (old.account_id=account_uuid and (old.date_of_birth=gymnast->>'dateOfBirth' or (lower(btrim(old.first_name))=lower(btrim(gymnast->>'firstName')) and lower(btrim(old.last_name))=lower(btrim(gymnast->>'lastName')))))
       or (old.date_of_birth=gymnast->>'dateOfBirth' and lower(btrim(old.first_name))=lower(btrim(gymnast->>'firstName')) and lower(btrim(old.last_name))=lower(btrim(gymnast->>'lastName')))
      )
    ) then raise exception 'IDENTITY_REVIEW_REQUIRED'; end if;
    -- Promote a uniquely matching user-entered child without changing its UUID/history.
    select count(*),(array_agg(old.id))[1] into manual_matches,manual_profile
    from public.dynamo_gymnasts old where old.account_id=account_uuid and old.source_id like 'manual:%'
     and old.date_of_birth=gymnast->>'dateOfBirth'
     and lower(btrim(old.first_name))=lower(btrim(gymnast->>'firstName'))
     and lower(btrim(old.last_name))=lower(btrim(gymnast->>'lastName'));
    if manual_matches>1 then raise exception 'IDENTITY_REVIEW_REQUIRED'; end if;
    if manual_matches=1 then update public.dynamo_gymnasts set source_id=gymnast->>'sourceId' where id=manual_profile;end if;
   end if;
   insert into public.dynamo_gymnasts(account_id,source_id,first_name,last_name,date_of_birth,bg_number,groups,active)
   values(account_uuid,gymnast->>'sourceId',gymnast->>'firstName',gymnast->>'lastName',gymnast->>'dateOfBirth',coalesce(gymnast->>'bgNumber',''),array(select jsonb_array_elements_text(gymnast->'groups')),(gymnast->>'active')::boolean)
   on conflict(source_id) do update set first_name=excluded.first_name,last_name=excluded.last_name,date_of_birth=excluded.date_of_birth,bg_number=excluded.bg_number,groups=excluded.groups,active=excluded.active;
  end loop;
 end loop;
 insert into public.dynamo_roster_runs(snapshot_hash,started_at,accounts,members,staff,gymnasts)
 values(p_hash,p_started_at,n_accounts,n_members,n_staff,n_gymnasts)
 on conflict(snapshot_hash) do update set started_at=excluded.started_at,completed_at=now(),accounts=excluded.accounts,members=excluded.members,staff=excluded.staff,gymnasts=excluded.gymnasts;
 return jsonb_build_object('unchanged',false,'accounts',n_accounts,'members',n_members,'staff',n_staff);
end $$;
revoke all on function public.apply_dynamo_roster(text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_dynamo_roster(text,timestamptz,jsonb) to service_role;
commit;
