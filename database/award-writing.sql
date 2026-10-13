alter table public.dynamo_award_items add column if not exists written_at timestamptz;
alter table public.dynamo_award_items add column if not exists written_by uuid;
grant update(written_at,written_by) on public.dynamo_award_items to service_role;
alter table public.dynamo_award_items add column if not exists created_at timestamptz not null default now();
update public.dynamo_award_items i set created_at=o.created_at from public.dynamo_award_orders o where i.order_id=o.id;
