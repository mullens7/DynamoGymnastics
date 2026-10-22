begin;
set local role service_role;
do $$
declare a jsonb;b jsonb;id uuid:=gen_random_uuid();d jsonb:='{"children":[{"first":"TEST ONLY"}]}'::jsonb;
begin
 a:=public.reserve_dynamo_waiting_list(id,repeat('a',64),d,'waiting-test-ip','waiting-test-email');
 b:=public.reserve_dynamo_waiting_list(id,repeat('a',64),d,'waiting-test-ip','waiting-test-email');
 if not (a->>'fresh')::boolean or (b->>'fresh')::boolean then raise exception 'DUPLICATE_CLAIM';end if;
 b:=public.reserve_dynamo_waiting_list(gen_random_uuid(),repeat('a',64),d,'waiting-test-ip','waiting-test-email');
 if (b->>'fresh')::boolean or b->'record'->>'id'<>id::text then raise exception 'DUPLICATE_CONTENT';end if;
 begin
  perform public.reserve_dynamo_waiting_list(id,repeat('b',64),d,'waiting-test-ip','waiting-test-email');
  raise exception 'EXPECTED_REJECTION';
 exception when others then if sqlerrm<>'SUBMISSION_CHANGED' then raise;end if;end;
 if has_table_privilege('anon','public.dynamo_waiting_list_submissions','select') or has_table_privilege('authenticated','public.dynamo_waiting_list_submissions','insert') or has_function_privilege('anon','public.reserve_dynamo_waiting_list(uuid,text,jsonb,text,text)','execute') then raise exception 'PUBLIC_ACCESS';end if;
end $$;
rollback;
