begin;
create table public.dynamo_erased_operations(id uuid primary key,account_id uuid not null references public.dynamo_accounts(id),erased_at timestamptz not null default now());
alter table public.dynamo_erased_operations enable row level security;
revoke all on public.dynamo_erased_operations from public,anon,authenticated;
grant select,insert on public.dynamo_erased_operations to service_role;
create table public.dynamo_history_erasure_runs(id uuid primary key,account_id uuid not null references public.dynamo_accounts(id),actor_id uuid not null references public.dynamo_accounts(id),items jsonb not null,result jsonb not null,created_at timestamptz not null default now());
alter table public.dynamo_history_erasure_runs enable row level security;
revoke all on public.dynamo_history_erasure_runs from public,anon,authenticated;
grant select,insert on public.dynamo_history_erasure_runs to service_role;
create or replace function public.erase_dynamo_contact_history(p_account uuid,p_actor uuid,p_operation uuid,p_items jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.dynamo_history_erasure_runs%rowtype;item jsonb;purchases uuid[]:='{}';payments uuid[]:='{}';wallet_rows uuid[]:='{}';event_rows uuid[]:='{}';party_rows uuid[]:='{}';selected_booking_ids uuid[];row_id uuid;total integer;result jsonb;
begin
 perform pg_advisory_xact_lock(719442004);
 if not exists(select 1 from public.dynamo_accounts a left join public.dynamo_staff_profiles s on s.account_id=a.id where a.id=p_actor and ((s.account_id is not null and s.enabled and (s.manual_staff or a.roster_staff) and 'super_admin'=any(coalesce(s.roles,array[s.role]))) or (s.account_id is null and a.email=any(array['freddie@dynamogymnastics.co.uk','kerri@dynamogymnastics.co.uk','admin@dynamogymnastics.co.uk','kayleigh@dynamogymnastics.co.uk','karen@dynamogymnastics.co.uk','anthony@dynamogymnastics.co.uk','tayah@dynamogymnastics.co.uk'])))) then raise exception 'STAFF_FORBIDDEN';end if;
 select * into prior from public.dynamo_history_erasure_runs where id=p_operation;if found then if prior.account_id<>p_account or prior.actor_id<>p_actor or prior.items<>p_items then raise exception 'OPERATION_CONFLICT';end if;return prior.result;end if;
 if p_operation is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'INVALID_HISTORY_SELECTION';end if;
 perform 1 from public.dynamo_accounts where id=p_account for update;if not found then raise exception 'HISTORY_NOT_FOUND';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  row_id:=(item->>'id')::uuid;
  case item->>'kind'
   when 'purchase' then if not exists(select 1 from public.dynamo_purchases where id=row_id and account_id=p_account) then raise exception 'HISTORY_NOT_FOUND';end if;purchases:=array_append(purchases,row_id);
   when 'payment' then if not exists(select 1 from public.dynamo_transactions where id=row_id and account_id=p_account and purchase_id is null) then raise exception 'HISTORY_NOT_FOUND';end if;payments:=array_append(payments,row_id);
   when 'wallet' then if not exists(select 1 from public.dynamo_wallet_ledger where id=row_id and account_id=p_account and purchase_id is null) then raise exception 'HISTORY_NOT_FOUND';end if;wallet_rows:=array_append(wallet_rows,row_id);
   when 'event' then if not exists(select 1 from public.dynamo_event_bookings where id=row_id and account_id=p_account and purchase_id is null) then raise exception 'HISTORY_NOT_FOUND';end if;event_rows:=array_append(event_rows,row_id);
   when 'party' then if not exists(select 1 from public.dynamo_party_bookings where id=row_id and account_id=p_account and purchase_id is null) then raise exception 'HISTORY_NOT_FOUND';end if;party_rows:=array_append(party_rows,row_id);
   else raise exception 'INVALID_HISTORY_SELECTION';
  end case;
 end loop;
 payments:=payments||array(select id from public.dynamo_transactions where purchase_id=any(purchases) and account_id=p_account);
 wallet_rows:=wallet_rows||array(select l.id from public.dynamo_wallet_ledger l where l.account_id=p_account and (l.purchase_id=any(purchases) or l.operation_id in (select r.id from public.dynamo_refunds r where r.transaction_id=any(payments))));
 event_rows:=event_rows||array(select id from public.dynamo_event_bookings where purchase_id=any(purchases) and account_id=p_account);
 party_rows:=party_rows||array(select id from public.dynamo_party_bookings where purchase_id=any(purchases) and account_id=p_account);
 selected_booking_ids:=event_rows||party_rows;
 if exists(select 1 from public.dynamo_confirmation_jobs j where j.account_id=p_account and j.booking_ids && selected_booking_ids and j.status='sending') then raise exception 'HISTORY_BUSY';end if;
 -- Keep only non-identifying operation IDs so an old request cannot recreate deleted history or repeat a wallet adjustment.
 insert into public.dynamo_erased_operations(id,account_id)
 select operation_id,p_account from public.dynamo_wallet_ledger where id=any(wallet_rows)
 union select id,p_account from public.dynamo_booking_actions where booking_id=any(selected_booking_ids)
 union select c.id,p_account from public.dynamo_basket_checkouts c where c.account_id=p_account and exists(select 1 from jsonb_array_elements(coalesce(c.result->'bookings','[]')) b where (b->>'bookingId')::uuid=any(selected_booking_ids))
 union select id,p_account from public.dynamo_award_orders where account_id=p_account and purchase_id=any(purchases)
 union select id,p_account from public.dynamo_refunds where transaction_id=any(payments)
 on conflict(id) do nothing;
 -- Remove only selected tickets from combined email deliveries; preserve other bookings from that basket.
 update public.dynamo_confirmation_jobs j set booking_ids=array(select value from unnest(j.booking_ids) value where not(value=any(selected_booking_ids))) where j.account_id=p_account and j.booking_ids && selected_booking_ids;
 delete from public.dynamo_confirmation_jobs j where j.account_id=p_account and cardinality(j.booking_ids)=0;
 delete from public.dynamo_basket_checkouts c where c.account_id=p_account and c.id in (select id from public.dynamo_erased_operations where account_id=p_account) and not exists(select 1 from public.dynamo_confirmation_jobs j where j.id=c.id);
 update public.dynamo_basket_checkouts c set items='[]',result='{"historyDeleted":true}' where c.account_id=p_account and c.id in (select id from public.dynamo_erased_operations where account_id=p_account);
 delete from public.dynamo_booking_actions where booking_id=any(selected_booking_ids);
 delete from public.dynamo_event_bookings where account_id=p_account and id=any(event_rows);
 delete from public.dynamo_party_bookings where account_id=p_account and id=any(party_rows);
 delete from public.dynamo_award_items where account_id=p_account and order_id in (select id from public.dynamo_award_orders where account_id=p_account and purchase_id=any(purchases));
 delete from public.dynamo_award_orders where account_id=p_account and purchase_id=any(purchases);
 delete from public.dynamo_refunds where transaction_id=any(payments);
 delete from public.dynamo_wallet_ledger where account_id=p_account and id=any(wallet_rows);
 delete from public.dynamo_transactions where account_id=p_account and id=any(payments);
 delete from public.dynamo_purchases where account_id=p_account and id=any(purchases);
 result:=jsonb_build_object('ok',true,'deletedSelections',jsonb_array_length(p_items),'deletedBookings',cardinality(selected_booking_ids),'walletUnchanged',true);
 insert into public.dynamo_history_erasure_runs(id,account_id,actor_id,items,result) values(p_operation,p_account,p_actor,p_items,result);
 return result;
end $$;
revoke all on function public.erase_dynamo_contact_history(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.erase_dynamo_contact_history(uuid,uuid,uuid,jsonb) to service_role;
grant delete on public.dynamo_purchases,public.dynamo_transactions,public.dynamo_event_bookings,public.dynamo_party_bookings,public.dynamo_wallet_ledger,public.dynamo_booking_actions,public.dynamo_confirmation_jobs,public.dynamo_basket_checkouts,public.dynamo_award_items,public.dynamo_award_orders,public.dynamo_refunds to service_role;
grant update on public.dynamo_basket_checkouts to service_role;
commit;
