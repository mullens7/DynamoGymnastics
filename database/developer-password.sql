begin;
create table public.dynamo_developer_passwords(
 email text primary key default 'freddie@mullens.com' check(email='freddie@mullens.com'),
 account_id uuid not null unique references public.dynamo_accounts(id),
 password_hash text not null check(password_hash ~ '^scrypt\$65536\$8\$2\$[a-f0-9]{32}\$[a-f0-9]{128}$'),
 version uuid not null default gen_random_uuid(),updated_at timestamptz not null default now()
);
create table public.dynamo_developer_password_attempts(
 id uuid primary key,ip_hash text not null check(ip_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default now(),consumed boolean not null default false,succeeded boolean not null default false
);
create index dynamo_developer_password_attempt_time on public.dynamo_developer_password_attempts(created_at);
create index dynamo_developer_password_attempt_ip on public.dynamo_developer_password_attempts(ip_hash,created_at);
alter table public.dynamo_developer_passwords enable row level security;
alter table public.dynamo_developer_password_attempts enable row level security;
revoke all on public.dynamo_developer_passwords,public.dynamo_developer_password_attempts from public,anon,authenticated;
grant select,insert,update,delete on public.dynamo_developer_passwords,public.dynamo_developer_password_attempts to service_role;

create function public.reserve_dynamo_developer_password_attempt(p_id uuid,p_ip text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare credential public.dynamo_developer_passwords%rowtype;retry integer;begin
 if p_id is null or p_ip is null or p_ip !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_LOGIN';end if;
 perform pg_advisory_xact_lock(719442010);
 delete from public.dynamo_developer_password_attempts where created_at<now()-interval '1 day';
 select * into credential from public.dynamo_developer_passwords where email='freddie@mullens.com';
 if not found then return jsonb_build_object('ok',false,'error','PASSWORD_NOT_SET');end if;
 if (select count(*) from public.dynamo_developer_password_attempts where not succeeded and created_at>now()-interval '15 minutes')>=5 then
 select greatest(1,ceil(extract(epoch from min(created_at)+interval '15 minutes'-now()))::integer) into retry from public.dynamo_developer_password_attempts where not succeeded and created_at>now()-interval '15 minutes';
 return jsonb_build_object('ok',false,'error','PASSWORD_RATE_LIMIT','retryAfter',retry);end if;
 if (select count(*) from public.dynamo_developer_password_attempts where ip_hash=p_ip and created_at>now()-interval '1 hour')>=20 then return jsonb_build_object('ok',false,'error','PASSWORD_RATE_LIMIT','retryAfter',3600);end if;
 insert into public.dynamo_developer_password_attempts(id,ip_hash) values(p_id,p_ip);
 return jsonb_build_object('ok',true,'passwordHash',credential.password_hash,'version',credential.version);
end $$;

create function public.finish_dynamo_developer_password_attempt(p_attempt uuid,p_version uuid,p_valid boolean,p_session_hash text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare attempt public.dynamo_developer_password_attempts%rowtype;credential public.dynamo_developer_passwords%rowtype;accepted boolean;begin
 if p_session_hash is not null and p_session_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_LOGIN';end if;
 perform pg_advisory_xact_lock(719442010);
 select * into attempt from public.dynamo_developer_password_attempts where id=p_attempt for update;
 if not found or attempt.consumed or attempt.created_at<now()-interval '2 minutes' then return jsonb_build_object('ok',false);end if;
 select * into credential from public.dynamo_developer_passwords where email='freddie@mullens.com';
 accepted:=coalesce(p_valid,false) and credential.version=p_version and exists(select 1 from public.dynamo_accounts where id=credential.account_id and email='freddie@mullens.com');
 update public.dynamo_developer_password_attempts set consumed=true,succeeded=coalesce(accepted,false) where id=p_attempt;
 if not coalesce(accepted,false) then return jsonb_build_object('ok',false);end if;
 if p_session_hash is not null then insert into public.dynamo_user_sessions(token_hash,account_id) values(p_session_hash,credential.account_id);end if;
 return jsonb_build_object('ok',true);
end $$;

create function public.set_dynamo_developer_password(p_actor uuid,p_session_hash text,p_password_hash text,p_expected_version uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior uuid;begin
 perform pg_advisory_xact_lock(719442010);
 if not exists(select 1 from public.dynamo_accounts a join public.dynamo_user_sessions s on s.account_id=a.id where a.id=p_actor and a.email='freddie@mullens.com' and s.token_hash=p_session_hash and s.expires_at>now()) then raise exception 'DEVELOPER_FORBIDDEN';end if;
 if p_password_hash is null or p_password_hash !~ '^scrypt\$65536\$8\$2\$[a-f0-9]{32}\$[a-f0-9]{128}$' then raise exception 'INVALID_PASSWORD_HASH';end if;
 select version into prior from public.dynamo_developer_passwords where email='freddie@mullens.com' for update;
 if prior is distinct from p_expected_version then raise exception 'PASSWORD_CHANGED';end if;
 insert into public.dynamo_developer_passwords(email,account_id,password_hash) values('freddie@mullens.com',p_actor,p_password_hash)
 on conflict(email) do update set password_hash=excluded.password_hash,version=gen_random_uuid(),updated_at=now();
 update public.dynamo_login_codes set consumed=true where email='freddie@mullens.com' and not consumed;
 delete from public.dynamo_user_sessions where account_id=p_actor and token_hash<>p_session_hash;
 update public.dynamo_user_sessions set expires_at=now()+interval '12 hours' where token_hash=p_session_hash;
 update public.dynamo_support_sessions set ended_at=coalesce(ended_at,now()) where actor_id=p_actor and ended_at is null;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.reserve_dynamo_developer_password_attempt(uuid,text),public.finish_dynamo_developer_password_attempt(uuid,uuid,boolean,text),public.set_dynamo_developer_password(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_dynamo_developer_password_attempt(uuid,text),public.finish_dynamo_developer_password_attempt(uuid,uuid,boolean,text),public.set_dynamo_developer_password(uuid,text,text,uuid) to service_role;
-- Once configured, even an old API deployment or an old OTP cannot bypass password login.
do $$declare definition text;guard text;begin
 guard:=E'begin\n if p_email=''freddie@mullens.com'' then\n perform pg_advisory_xact_lock(719442010);\n if exists(select 1 from public.dynamo_developer_passwords where email=p_email) then return jsonb_build_object(''ok'',false,''error'',''PASSWORD_REQUIRED'');end if;end if;\n';
 select pg_get_functiondef('public.request_dynamo_code(uuid,text,text,text)'::regprocedure) into definition;
 if position(E'begin\n' in definition)=0 then raise exception 'OTP request guard needs review';end if;
 execute replace(definition,E'begin\n',guard);
 guard:=E'begin\n if exists(select 1 from public.dynamo_login_codes where id=p_id and email=''freddie@mullens.com'') then\n perform pg_advisory_xact_lock(719442010);\n if exists(select 1 from public.dynamo_developer_passwords where email=''freddie@mullens.com'') then return jsonb_build_object(''ok'',false,''error'',''PASSWORD_REQUIRED'');end if;end if;\n';
 select pg_get_functiondef('public.verify_dynamo_code(uuid,text,text)'::regprocedure) into definition;
 if position(E'begin\n' in definition)=0 then raise exception 'OTP verification guard needs review';end if;
 execute replace(definition,E'begin\n',guard);
end $$;
notify pgrst,'reload schema';
commit;
