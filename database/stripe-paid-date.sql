-- Preserve the provider's payment date when a delayed callback is recovered.
create or replace function public.record_dynamo_payment_date(p_order uuid,p_payment text,p_paid_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare checkout public.dynamo_card_checkouts%rowtype;
begin
 perform pg_advisory_xact_lock(719442001);
 select * into checkout from public.dynamo_card_checkouts where id=p_order for update;
 if not found or checkout.state<>'paid' or checkout.payment_intent is distinct from p_payment
  or p_paid_at is null or p_paid_at<checkout.created_at-interval '1 minute' or p_paid_at>now()+interval '1 minute'
 then raise exception 'PAYMENT_MISMATCH';end if;
 update public.dynamo_card_checkouts set settled_at=p_paid_at where id=p_order;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.record_dynamo_payment_date(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_dynamo_payment_date(uuid,text,timestamptz) to service_role;
notify pgrst,'reload schema';
