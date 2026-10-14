begin;
alter table public.dynamo_card_refunds add column move_operation uuid;
-- Queue original-card refunds atomically with cheaper-session moves. Stripe is
-- contacted after commit; an uncertain response keeps the same operation ID.
do $$declare def text;begin
 select pg_get_functiondef(oid) into def from pg_proc where proname='quote_dynamo_event_move';
 def:=replace(def,'bool_and(payment_method=''wallet'')','bool_and(payment_method=''wallet'' or payment_method=''card'' and card_checkout_id is not null)');execute def;
 select pg_get_functiondef(oid) into def from pg_proc where proname='move_dynamo_event_booking';
 def:=replace(def,'result jsonb;','result jsonb;refunds jsonb:=''[]'';');
 def:=replace(def,'quote:=public.quote_dynamo_event_move',E'if exists(select 1 from public.dynamo_card_refunds r join public.dynamo_transactions t on t.id=r.transaction_id join public.dynamo_event_bookings b on b.purchase_id=t.purchase_id where b.id=p_booking and r.state in (''creating'',''pending'',''review'')) then raise exception ''PAYMENT_PENDING'';end if;\n quote:=public.quote_dynamo_event_move');
 def:=replace(def,'update public.dynamo_transactions set refunded_pence=refunded_pence+portion',E'if p_return=''refund'' and tx.payment_method=''card'' then\n insert into public.dynamo_card_refunds(id,transaction_id,actor_id,amount_pence,reason,move_operation) values(refund_op,tx.id,p_actor,portion,''Booking move: original card refund'',p_operation);\n refunds:=refunds||jsonb_build_array(jsonb_build_object(''id'',refund_op,''transactionId'',tx.id,''amountPence'',portion,''reason'',''Booking move: original card refund''));remaining:=remaining-portion;continue;end if;\n update public.dynamo_transactions set refunded_pence=refunded_pence+portion');
 def:=replace(def,'''bookingId'',p_booking)','''bookingId'',p_booking,''refundRequests'',refunds)');
 execute def;
end $$;
commit;
