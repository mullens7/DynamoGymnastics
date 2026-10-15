begin;
create or replace function public.dynamo_ticket_service_fee(card_pence bigint,ticket_count integer) returns bigint language sql immutable security invoker set search_path='' as $$
 select case when card_pence>0 then least(card_pence,(card_pence*250+5000)/10000+20*greatest(1,ticket_count)::bigint) else 0 end;
$$;
revoke all on function public.dynamo_ticket_service_fee(bigint,integer) from public,anon,authenticated;
grant execute on function public.dynamo_ticket_service_fee(bigint,integer) to service_role;
do $$declare def text;old text:='case when p_expected_total-used>0 then ((p_expected_total-used)*250+5000)/10000+20 else 0 end';begin
 select pg_get_functiondef('public.prepare_dynamo_card_checkout(uuid,text,jsonb,boolean,uuid,bigint,text,text)'::regprocedure) into def;
 if position(old in def)=0 then raise exception 'Fee migration does not match the current checkout function';end if;
 def:=replace(def,'p_origin,'||old||');','p_origin,0);');
 def:=replace(def,'fee:='||old||';fee_left:=fee;', 'fee:=public.dynamo_ticket_service_fee(p_expected_total-used,case when p_kind=''basket'' then jsonb_array_length(v_result->''bookings'') else 1 end);update public.dynamo_card_checkouts set service_fee_pence=fee where id=p_operation;fee_left:=fee;');
 if position(old in def)>0 or position('jsonb_array_length(v_result->''bookings'')' in def)=0 then raise exception 'Fee patch incomplete';end if;
 execute def;
end $$;
commit;
