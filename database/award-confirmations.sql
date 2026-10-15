begin;
alter table public.dynamo_confirmation_settings drop constraint dynamo_confirmation_settings_kind_check;
alter table public.dynamo_confirmation_settings add constraint dynamo_confirmation_settings_kind_check check(kind in ('event','party','award'));
insert into public.dynamo_confirmation_settings(kind,details) values('award','{"enabled":true,"qrEnabled":false,"subject":"Your Dynamo award order confirmation","greeting":"Hi {parentName},","intro":"Thank you for purchasing your gymnastics awards. Your confirmed award order is below.","instructions":"Your awards will be prepared for your gymnast’s class."}') on conflict(kind) do nothing;
create table public.dynamo_award_confirmation_jobs(
 id uuid primary key references public.dynamo_award_orders(id) on delete cascade,
 account_id uuid not null references public.dynamo_accounts(id),
 status text not null default 'pending' check(status in ('pending','sending','sent','review','skipped')),
 error_code text,created_at timestamptz not null default now(),attempted_at timestamptz,sent_at timestamptz
);
alter table public.dynamo_award_confirmation_jobs enable row level security;
revoke all on public.dynamo_award_confirmation_jobs from public,anon,authenticated;
grant select,insert,update on public.dynamo_award_confirmation_jobs to service_role;
create index dynamo_award_confirmation_account on public.dynamo_award_confirmation_jobs(account_id);
create index dynamo_award_confirmation_pending on public.dynamo_award_confirmation_jobs(status,created_at);
create function public.queue_dynamo_award_confirmation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.kind='awards' and new.state='paid' then
  insert into public.dynamo_award_confirmation_jobs(id,account_id)
  select id,account_id from public.dynamo_award_orders where id=new.id and account_id=new.account_id and not payment_pending
  on conflict(id) do nothing;
 end if;
 return new;
end;
$$;
revoke all on function public.queue_dynamo_award_confirmation() from public,anon,authenticated;
grant execute on function public.queue_dynamo_award_confirmation() to service_role;
create trigger dynamo_award_confirmation_after_payment after insert or update of state on public.dynamo_card_checkouts for each row execute function public.queue_dynamo_award_confirmation();
commit;
