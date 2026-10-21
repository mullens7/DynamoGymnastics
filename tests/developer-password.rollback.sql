begin;
do $test$
declare developer uuid;other uuid:=gen_random_uuid();challenge uuid:=gen_random_uuid();attempt uuid;v_version uuid;result jsonb;good_hash text:='scrypt$65536$8$2$'||repeat('a',32)||'$'||repeat('b',128);session_hash text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);other_session text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);begin
 insert into public.dynamo_accounts(email) values('freddie@mullens.com') on conflict(email) do nothing;
 select id into developer from public.dynamo_accounts where email='freddie@mullens.com';
 delete from public.dynamo_developer_passwords where email='freddie@mullens.com';
 delete from public.dynamo_developer_password_attempts;
 insert into public.dynamo_accounts(id,email) values(other,'password-test-'||other||'@example.invalid');
 insert into public.dynamo_user_sessions(token_hash,account_id) values(session_hash,developer),(other_session,developer);
 insert into public.dynamo_login_codes(id,email,ip_hash,code_hash) values(challenge,'freddie@mullens.com',repeat('c',64),repeat('d',64));
 begin perform public.set_dynamo_developer_password(other,session_hash,good_hash,null);raise exception 'Other account set developer password';exception when others then if sqlerrm<>'DEVELOPER_FORBIDDEN' then raise;end if;end;
 begin perform public.set_dynamo_developer_password(developer,repeat('e',64),good_hash,null);raise exception 'Invalid session set password';exception when others then if sqlerrm<>'DEVELOPER_FORBIDDEN' then raise;end if;end;
 perform public.set_dynamo_developer_password(developer,session_hash,good_hash,null);
 select version into v_version from public.dynamo_developer_passwords where email='freddie@mullens.com';
 if exists(select 1 from public.dynamo_user_sessions where account_id=developer and token_hash<>session_hash) or not exists(select 1 from public.dynamo_login_codes where id=challenge and consumed) then raise exception 'Other sessions or OTPs survived setup';end if;
 result:=public.request_dynamo_code(gen_random_uuid(),'freddie@mullens.com',repeat('c',64),repeat('d',64));if result->>'error'<>'PASSWORD_REQUIRED' then raise exception 'Developer OTP request allowed';end if;
 result:=public.verify_dynamo_code(challenge,repeat('d',64),repeat('e',64));if result->>'error'<>'PASSWORD_REQUIRED' then raise exception 'Old developer OTP allowed';end if;
 for i in 1..5 loop
 attempt:=gen_random_uuid();result:=public.reserve_dynamo_developer_password_attempt(attempt,repeat('c',64));if result->>'ok'<>'true' then raise exception 'Initial password attempt rejected';end if;
 result:=public.finish_dynamo_developer_password_attempt(attempt,v_version,false,repeat('e',64));if result->>'ok'<>'false' then raise exception 'Bad password created session';end if;
 end loop;
 result:=public.reserve_dynamo_developer_password_attempt(gen_random_uuid(),repeat('f',64));if result->>'error'<>'PASSWORD_RATE_LIMIT' then raise exception 'IP rotation bypassed account lockout';end if;
 if exists(select 1 from public.dynamo_user_sessions where token_hash=repeat('e',64)) then raise exception 'Failed passwords created session';end if;
 update public.dynamo_developer_password_attempts set created_at=now()-interval '16 minutes';
 attempt:=gen_random_uuid();result:=public.reserve_dynamo_developer_password_attempt(attempt,repeat('c',64));if result->>'ok'<>'true' then raise exception 'Temporary lock did not expire';end if;
 result:=public.finish_dynamo_developer_password_attempt(attempt,v_version,true,repeat('e',64));if result->>'ok'<>'true' or not exists(select 1 from public.dynamo_user_sessions where account_id=developer and token_hash=repeat('e',64)) then raise exception 'Valid password did not create developer session';end if;
 result:=public.finish_dynamo_developer_password_attempt(attempt,v_version,true,repeat('f',64));if result->>'ok'<>'false' then raise exception 'Attempt reused';end if;
 attempt:=gen_random_uuid();perform public.reserve_dynamo_developer_password_attempt(attempt,repeat('c',64));
 perform public.set_dynamo_developer_password(developer,session_hash,good_hash,v_version);
 result:=public.finish_dynamo_developer_password_attempt(attempt,v_version,true,repeat('f',64));if result->>'ok'<>'false' then raise exception 'Old hash version used after change';end if;
 begin perform public.set_dynamo_developer_password(developer,session_hash,good_hash,v_version);raise exception 'Stale password update accepted';exception when others then if sqlerrm<>'PASSWORD_CHANGED' then raise;end if;end;
 result:=public.request_dynamo_code(gen_random_uuid(),'password-otp-'||other||'@example.invalid',repeat('a',64),repeat('d',64));if result->>'ok'<>'true' then raise exception 'Normal OTP login changed';end if;
 if has_function_privilege('anon','public.set_dynamo_developer_password(uuid,text,text,uuid)','execute') or has_function_privilege('authenticated','public.reserve_dynamo_developer_password_attempt(uuid,text)','execute') or has_table_privilege('anon','public.dynamo_developer_passwords','select') then raise exception 'Browser role granted private access';end if;
end $test$;
rollback;
