begin;
alter table public.dynamo_card_checkouts add column service_fee_pence bigint not null default 0 check(service_fee_pence>=0);
alter table public.dynamo_transactions add column service_fee_pence bigint not null default 0 check(service_fee_pence>=0);
do $$declare def text;begin
 select pg_get_functiondef(oid) into def from pg_proc where proname='prepare_dynamo_card_checkout';
 def:=replace(def,'running bigint;','running bigint;fee bigint;fee_left bigint;fee_part bigint;card_left bigint;');
 def:=replace(def,'credit_left,connected_account,return_origin) values','credit_left,connected_account,return_origin,service_fee_pence) values');
 def:=replace(def,'used,p_connected,p_origin);','used,p_connected,p_origin,case when p_expected_total-used>0 then ((p_expected_total-used)*250+5000)/10000+20 else 0 end);');
 def:=replace(def,'v_result:=v_result||jsonb_build_object',E'fee:=case when p_expected_total-used>0 then ((p_expected_total-used)*250+5000)/10000+20 else 0 end;fee_left:=fee;card_left:=p_expected_total-used;\n for rec in select * from public.dynamo_transactions where card_checkout_id=p_operation and payment_method=''card'' order by created_at,id for update loop\n fee_part:=case when rec.amount_pence=card_left then fee_left else fee_left*rec.amount_pence/card_left end;\n update public.dynamo_transactions set service_fee_pence=fee_part where id=rec.id;fee_left:=fee_left-fee_part;card_left:=card_left-rec.amount_pence;end loop;\n v_result:=v_result||jsonb_build_object');
 if position('service_fee_pence) values' in def)=0 or position('fee_part:=' in def)=0 then raise exception 'Fee patch did not match';end if;execute def;
end $$;
commit;
