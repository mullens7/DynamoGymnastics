create table if not exists public.dynamo_contact_limits (
 key text not null, bucket timestamptz not null, attempts integer not null,
 primary key(key,bucket)
);
alter table public.dynamo_contact_limits enable row level security;
revoke all on public.dynamo_contact_limits from anon,authenticated;
grant select,insert,update,delete on public.dynamo_contact_limits to service_role;
create or replace function public.limit_dynamo_contact(p_key text) returns boolean
language plpgsql security invoker set search_path=public as $$
declare amount integer;
begin
 delete from public.dynamo_contact_limits where bucket < now()-interval '2 hours';
 insert into public.dynamo_contact_limits(key,bucket,attempts)
 values(p_key,date_trunc('hour',now()),1)
 on conflict(key,bucket) do update set attempts=dynamo_contact_limits.attempts+1
 returning attempts into amount;
 return amount<=5;
end;
$$;
revoke all on function public.limit_dynamo_contact(text) from public,anon,authenticated;
grant execute on function public.limit_dynamo_contact(text) to service_role;
