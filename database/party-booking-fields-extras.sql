-- Party booking questions and server-calculated extra children.
create or replace function public.dynamo_party_children_extra(p_target uuid,p_children integer) returns bigint language plpgsql security invoker set search_path='' as $$
declare info jsonb;cfg jsonb;included integer;maximum integer;fee bigint;begin
 select details into info from public.dynamo_parties where id=p_target and not archived;
 if info is null then raise exception 'SESSION_UNAVAILABLE';end if;
 select details into cfg from public.dynamo_party_types where id=coalesce(info->>'partyType',case when info->>'room'='Small gym' then 'preschool' else 'dynamo' end);
 maximum:=coalesce((cfg->>'guests')::integer,(info->>'guests')::integer,1000);included:=coalesce((cfg->>'includedChildren')::integer,maximum);fee:=coalesce((cfg->>'extraChildPriceCents')::bigint,0);
 if p_children is null or p_children<1 or p_children>maximum then raise exception 'PARTY_CHILD_COUNT';end if;
 if included<1 or included>maximum or fee<0 then raise exception 'PRICE_NOT_CONFIGURED';end if;
 return greatest(0,p_children-included)*fee;
end $$;
revoke all on function public.dynamo_party_children_extra(uuid,integer) from public,anon,authenticated;
grant execute on function public.dynamo_party_children_extra(uuid,integer) to service_role;
-- Clone the established atomic booking function; only the counted variant is used by party baskets.
do $$declare def text;old text;begin
 select pg_get_functiondef('public.book_dynamo_session_v2(text,uuid,uuid,uuid,boolean,uuid,boolean)'::regprocedure) into def;
 def:=replace(def,'public.book_dynamo_session_v2(', 'public.book_dynamo_party_counted(');
 def:=replace(def,'p_room_addon boolean)', 'p_room_addon boolean, p_children integer)');
 old:='price:=public.dynamo_party_price(p_target,public.dynamo_account_is_member(account.id),p_room_addon);';
 if position(old in def)=0 then raise exception 'Party counted price patch requires review';end if;
 def:=replace(def,old,old||'price:=price+public.dynamo_party_children_extra(p_target,p_children);');
 def:=replace(def,'coalesce((prior.details->>''roomAddon'')::boolean,false)<>p_room_addon', 'coalesce((prior.details->>''roomAddon'')::boolean,false)<>p_room_addon or (prior.details->>''children'')::integer is distinct from p_children');
 def:=replace(def,'''roomAddon'',p_room_addon));', '''roomAddon'',p_room_addon,''children'',p_children));');
 execute def;
end $$;
revoke all on function public.book_dynamo_party_counted(text,uuid,uuid,uuid,boolean,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.book_dynamo_party_counted(text,uuid,uuid,uuid,boolean,uuid,boolean,integer) to service_role;
create or replace function public.validate_dynamo_party_details(p_target uuid,p_item jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg jsonb;info jsonb;contact text:=trim(p_item->'partyDetails'->>'contactNumber');children integer;extra bigint;included integer;begin
 select details into info from public.dynamo_parties where id=p_target and not archived;
 select details into cfg from public.dynamo_party_types where id=coalesce(info->>'partyType',case when info->>'room'='Small gym' then 'preschool' else 'dynamo' end);
 if contact is null or contact !~ '^[+0-9 ()-]{6,25}$' or coalesce(p_item->'partyDetails'->>'numberOfChildren','') !~ '^[0-9]{1,4}$' then raise exception 'PARTY_DETAILS_REQUIRED';end if;
 children:=(p_item->'partyDetails'->>'numberOfChildren')::integer;extra:=public.dynamo_party_children_extra(p_target,children);included:=coalesce((cfg->>'includedChildren')::integer,(cfg->>'guests')::integer,(info->>'guests')::integer,1000);
 return jsonb_build_object('contactNumber',contact,'numberOfChildren',children,'includedChildren',included,'additionalChildren',greatest(0,children-included),'extraChildPricePence',coalesce((cfg->>'extraChildPriceCents')::bigint,0),'extraChildrenPence',extra);
end $$;
-- Use party type questions with the existing validated answer snapshot mechanism.
do $$declare def text;old text;begin
 select pg_get_functiondef('public.validate_dynamo_booking_answers(uuid,jsonb)'::regprocedure) into def;
 old:='if fields is null then raise exception ''SESSION_UNAVAILABLE'';end if;';
 if position(old in def)=0 then raise exception 'Party answer fields patch requires review';end if;
 def:=replace(def,old,'elsif p_item->>''kind''=''party'' then select coalesce(t.details->''bookingFields'',''[]''::jsonb) into fields from public.dynamo_parties p join public.dynamo_party_types t on t.id=coalesce(p.details->>''partyType'',case when p.details->>''room''=''Small gym'' then ''preschool'' else ''dynamo'' end) where p.id=(p_item->>''targetId'')::uuid and not p.archived;end if;'||chr(10)||old);
 def:=replace(def,'end if;'||chr(10)||' if jsonb_typeof(answers)', 'if jsonb_typeof(answers)');
 execute def;
 select pg_get_functiondef('public.checkout_dynamo_basket(uuid,jsonb,boolean,uuid,bigint)'::regprocedure) into def;
 old:='price:=public.dynamo_party_price((item->>''targetId'')::uuid,member,coalesce((item->>''roomAddon'')::boolean,false));';
 if position(old in def)=0 then raise exception 'Party basket total patch requires review';end if;
 def:=replace(def,old,'perform public.validate_dynamo_party_details((item->>''targetId'')::uuid,item);'||old||'price:=price+public.dynamo_party_children_extra((item->>''targetId'')::uuid,(item->''partyDetails''->>''numberOfChildren'')::integer);');
 old:='public.book_dynamo_session_v2(''party'',(item->>''targetId'')::uuid,p_account,(item->>''gymnastId'')::uuid,p_credit,gen_random_uuid(),coalesce((item->>''roomAddon'')::boolean,false))';
 if position(old in def)=0 then raise exception 'Party counted booking patch requires review';end if;
 def:=replace(def,old,'public.book_dynamo_party_counted(''party'',(item->>''targetId'')::uuid,p_account,(item->>''gymnastId'')::uuid,p_credit,gen_random_uuid(),coalesce((item->>''roomAddon'')::boolean,false),(item->''partyDetails''->>''numberOfChildren'')::integer)');
 def:=replace(def,'party_details=public.validate_dynamo_party_details((item->>''targetId'')::uuid,item) where', 'party_details=public.validate_dynamo_party_details((item->>''targetId'')::uuid,item)||jsonb_build_object(''responses'',snapshot->''answers'') where');
 execute def;
end $$;
