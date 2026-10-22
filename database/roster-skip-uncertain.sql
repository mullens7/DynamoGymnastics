-- Import valid records; leave uncertain profiles untouched.
create or replace function public.apply_dynamo_roster(p_hash text,p_started_at timestamptz,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.dynamo_roster_runs%rowtype; same public.dynamo_roster_runs%rowtype;
 n_accounts integer; n_members integer; n_staff integer; n_gymnasts integer;
 owner jsonb; gymnast jsonb; account_uuid uuid; existing_owner uuid; manual_profile uuid; manual_matches integer; prior_active uuid[]; protected_ids uuid[]:=array[]::uuid[]; skipped jsonb:='[]'::jsonb;
begin
 perform pg_advisory_xact_lock(719442001);
 if p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'SNAPSHOT_REVIEW_REQUIRED'; end if;
 select * into same from public.dynamo_roster_runs order by started_at desc limit 1;

 select count(*),count(*) filter(where (x->>'member')::boolean),count(*) filter(where (x->>'staff')::boolean),coalesce(sum(jsonb_array_length(x->'gymnasts')),0)
 into n_accounts,n_members,n_staff,n_gymnasts from jsonb_array_elements(p_rows) x;
 select * into previous from public.dynamo_roster_runs order by started_at desc limit 1;
 if found then
  if p_started_at<=previous.started_at then raise exception 'STALE_SNAPSHOT'; end if;
  if n_accounts<previous.accounts*0.75 or n_members<previous.members*0.75 or n_gymnasts<previous.gymnasts*0.75 then raise exception 'SNAPSHOT_REVIEW_REQUIRED'; end if;
 end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into prior_active from public.dynamo_gymnasts where active;
 select coalesce(array_agg(g.id),'{}'::uuid[]) into protected_ids from public.dynamo_gymnasts g
 join public.dynamo_accounts a on a.id=g.account_id
 where g.source_id not like 'manual:%' and exists(select 1 from jsonb_array_elements(p_rows) x where x->>'email'=a.email and x->>'preserveExisting'='true');
 update public.dynamo_accounts set roster_member=false,roster_staff=false where roster_member or roster_staff;
 update public.dynamo_gymnasts set active=false where active;
 for owner in select value from jsonb_array_elements(p_rows) loop
  insert into public.dynamo_accounts(email,owner_name,roster_member,roster_staff)
  values(owner->>'email',coalesce(owner->>'ownerName',''),(owner->>'member')::boolean,(owner->>'staff')::boolean)
  on conflict(email) do update set owner_name=excluded.owner_name,roster_member=excluded.roster_member,roster_staff=excluded.roster_staff
  returning id into account_uuid;
  for gymnast in select value from jsonb_array_elements(owner->'gymnasts') loop
   begin
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
   insert into public.dynamo_gymnasts(account_id,source_id,first_name,last_name,date_of_birth,bg_number,groups,active,time_class)
   values(account_uuid,gymnast->>'sourceId',gymnast->>'firstName',gymnast->>'lastName',gymnast->>'dateOfBirth',coalesce(gymnast->>'bgNumber',''),array(select jsonb_array_elements_text(gymnast->'groups')),(gymnast->>'active')::boolean,coalesce(gymnast->>'timeClass',''))
   on conflict(source_id) do update set first_name=excluded.first_name,last_name=excluded.last_name,date_of_birth=excluded.date_of_birth,bg_number=excluded.bg_number,groups=excluded.groups,active=excluded.active,time_class=excluded.time_class;
   exception when raise_exception then
    if sqlerrm<>'IDENTITY_REVIEW_REQUIRED' then raise;end if;
    -- Keep questionable profiles exactly as they were; continue with other children.
    skipped:=skipped||jsonb_build_array(jsonb_build_object('name',concat_ws(' ',gymnast->>'firstName',gymnast->>'lastName'),'reason','Identity details changed or match more than one profile. Existing data retained.'));
    protected_ids:=protected_ids||array(
     select old.id from public.dynamo_gymnasts old where old.source_id=gymnast->>'sourceId'
      or (old.source_id like 'derived:%' and (
       (old.account_id=account_uuid and (old.date_of_birth=gymnast->>'dateOfBirth' or (lower(btrim(old.first_name))=lower(btrim(gymnast->>'firstName')) and lower(btrim(old.last_name))=lower(btrim(gymnast->>'lastName')))))
       or (old.date_of_birth=gymnast->>'dateOfBirth' and lower(btrim(old.first_name))=lower(btrim(gymnast->>'firstName')) and lower(btrim(old.last_name))=lower(btrim(gymnast->>'lastName')))))
      or (old.source_id like 'manual:%' and old.account_id=account_uuid and old.date_of_birth=gymnast->>'dateOfBirth' and lower(btrim(old.first_name))=lower(btrim(gymnast->>'firstName')) and lower(btrim(old.last_name))=lower(btrim(gymnast->>'lastName')))
    );
   end;
  end loop;
 end loop;
 -- Only profiles ignored because of uncertain data retain their earlier active state.
 update public.dynamo_gymnasts set active=true where id=any(protected_ids) and id=any(prior_active);
 update public.dynamo_accounts a set roster_member=exists(select 1 from public.dynamo_gymnasts g where g.account_id=a.id and g.active)
 where exists(select 1 from jsonb_array_elements(p_rows) x where x->>'email'=a.email) or exists(select 1 from public.dynamo_gymnasts g where g.account_id=a.id and g.id=any(protected_ids));
 select count(*) into n_members from public.dynamo_accounts a where a.roster_member and (exists(select 1 from jsonb_array_elements(p_rows) x where x->>'email'=a.email) or exists(select 1 from public.dynamo_gymnasts g where g.account_id=a.id and g.id=any(protected_ids)));
 insert into public.dynamo_roster_runs(snapshot_hash,started_at,accounts,members,staff,gymnasts)
 values(p_hash,p_started_at,n_accounts,n_members,n_staff,n_gymnasts)
 on conflict(snapshot_hash) do update set started_at=excluded.started_at,completed_at=now(),accounts=excluded.accounts,members=excluded.members,staff=excluded.staff,gymnasts=excluded.gymnasts;
 return jsonb_build_object('unchanged',same.snapshot_hash=p_hash,'accounts',n_accounts,'members',n_members,'staff',n_staff,'skippedRecords',skipped);
end $$;
revoke all on function public.apply_dynamo_roster(text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_dynamo_roster(text,timestamptz,jsonb) to service_role;
notify pgrst,'reload schema';
