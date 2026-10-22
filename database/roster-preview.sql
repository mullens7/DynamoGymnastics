-- Server-only diagnosis: all attempted roster writes roll back before returning.
create or replace function public.preview_dynamo_rosters(p_hash text,p_started_at timestamptz,p_rows jsonb,p_sources jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; failure text;
begin
 begin
  result:=public.apply_dynamo_rosters(p_hash,p_started_at,p_rows,p_sources);
  raise exception using errcode='Z0001',message='PREVIEW_ROLLBACK';
 exception when sqlstate 'Z0001' then null;
 when others then failure:=sqlerrm;
 end;
 if failure is null then return jsonb_build_object('ok',true,'preview',true,'result',result);end if;
 return jsonb_build_object('ok',false,'error',failure,'review',(
  select coalesce(jsonb_agg(c),'[]'::jsonb) from (
   select a->>'email' as owner_email,g->>'firstName' as first_name,g->>'lastName' as last_name,g->>'dateOfBirth' as date_of_birth,
    old.id as existing_id,old.first_name as existing_first_name,old.last_name as existing_last_name,old.date_of_birth as existing_date_of_birth,
    case when old.account_id<>account.id then 'different_owner' when old.source_id like 'manual:%' then 'manual_match' else 'changed_details' end as reason
   from jsonb_array_elements(p_rows) a cross join lateral jsonb_array_elements(a->'gymnasts') g
   join public.dynamo_accounts account on account.email=a->>'email'
   join public.dynamo_gymnasts old on
    (old.source_id=g->>'sourceId' and old.account_id<>account.id)
    or (g->>'sourceId' like 'derived:%' and old.source_id like 'derived:%'
     and not exists(select 1 from jsonb_array_elements(p_rows) aa cross join lateral jsonb_array_elements(aa->'gymnasts') gg where gg->>'sourceId'=old.source_id)
     and ((old.account_id=account.id and (old.date_of_birth=g->>'dateOfBirth' or (lower(btrim(old.first_name))=lower(btrim(g->>'firstName')) and lower(btrim(old.last_name))=lower(btrim(g->>'lastName')))))
       or (old.date_of_birth=g->>'dateOfBirth' and lower(btrim(old.first_name))=lower(btrim(g->>'firstName')) and lower(btrim(old.last_name))=lower(btrim(g->>'lastName')))))
   limit 20
  ) c));
end $$;
revoke all on function public.preview_dynamo_rosters(text,timestamptz,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.preview_dynamo_rosters(text,timestamptz,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
