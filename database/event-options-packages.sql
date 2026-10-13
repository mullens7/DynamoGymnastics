begin;
alter table public.dynamo_event_bookings add column selection jsonb not null default '{}';
create function public.dynamo_expand_event_selection(p_account uuid,p_item jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare info jsonb;cfg jsonb;opt jsonb;entry jsonb;line jsonb;selection jsonb;result jsonb:='[]';total bigint;price bigint;member boolean:=public.dynamo_account_is_member(p_account);idx integer:=0;n integer;
begin
 if p_item->>'kind'<>'event' then return jsonb_build_array(p_item);end if;
 select details into info from public.dynamo_events where id=(p_item->>'targetId')::uuid and not archived;
 if info is null or info->>'status'<>'Published' then raise exception 'SESSION_UNAVAILABLE';end if;
 if p_item->>'packageId' is not null then
  if not(info ? 'sessions') then raise exception 'PACKAGE_UNAVAILABLE';end if;
  select value into cfg from jsonb_array_elements(coalesce(info->'packages','[]')) where value->>'id'=p_item->>'packageId' and (value->>'enabled')::boolean;
  if cfg is null then raise exception 'PACKAGE_UNAVAILABLE';end if;
  total:=(cfg->>(case when member then 'memberPriceCents' else 'nonMemberPriceCents' end))::bigint;n:=jsonb_array_length(cfg->'items');if n<2 or n>50 or total is null or total<0 then raise exception 'PACKAGE_UNAVAILABLE';end if;
  for entry in select value from jsonb_array_elements(cfg->'items') loop
   if not exists(select 1 from public.dynamo_events where id=(entry->>'sessionId')::uuid and details->>'parentId'=p_item->>'targetId' and not archived) then raise exception 'PACKAGE_UNAVAILABLE';end if;
   line:=p_item-'packageId'||jsonb_build_object('targetId',entry->>'sessionId','optionId',entry->'optionId');
   selection:=public.dynamo_expand_event_selection(p_account,line)->0;
   price:=total/n+case when idx<total%n then 1 else 0 end;idx:=idx+1;
   selection:=selection||jsonb_build_object('_pricePence',price,'_selection',selection->'_selection'||jsonb_build_object('packageId',cfg->>'id','packageName',cfg->>'name','packageTotalPence',total,'packageSessionCount',n));
   result:=result||jsonb_build_array(selection);
  end loop;return result;
 end if;
 if info ? 'sessions' then raise exception 'PACKAGE_UNAVAILABLE';end if;
 if jsonb_array_length(coalesce(info->'pricingOptions','[]'))>0 then
  select value into opt from jsonb_array_elements(info->'pricingOptions') where value->>'id'=p_item->>'optionId' and (value->>'enabled')::boolean;
  if opt is null then raise exception 'PACKAGE_UNAVAILABLE';end if;
  price:=(opt->>(case when member then 'memberPriceCents' else 'nonMemberPriceCents' end))::bigint;
  selection:=jsonb_build_object('optionId',opt->>'id','optionName',opt->>'name','time',opt->>'startTime','endTime',opt->>'endTime');
 else
  if p_item->>'optionId' is not null then raise exception 'PACKAGE_UNAVAILABLE';end if;
  price:=(info->>(case when member then 'memberPriceCents' else 'nonMemberPriceCents' end))::bigint;
  selection:=jsonb_build_object('time',info->>'time','endTime',info->>'endTime');
 end if;
 if price is null or price<0 then raise exception 'PRICE_NOT_CONFIGURED';end if;
 return jsonb_build_array(p_item||jsonb_build_object('_pricePence',price,'_selection',selection));
end $$;
revoke all on function public.dynamo_expand_event_selection(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dynamo_expand_event_selection(uuid,jsonb) to service_role;
do $$declare def text;begin
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='book_dynamo_session';
 def:=replace(def,'public.book_dynamo_session(p_kind text, p_target uuid, p_account uuid, p_gymnast uuid, p_credit boolean, p_operation uuid)','public.book_dynamo_event_priced(p_kind text, p_target uuid, p_account uuid, p_gymnast uuid, p_credit boolean, p_operation uuid, p_price bigint, p_selection jsonb)');
 def:=replace(def,'perform pg_advisory_xact_lock(719442004);','if p_kind<>''event'' then raise exception ''INVALID_BOOKING'';end if;perform pg_advisory_xact_lock(719442004);');
 def:=replace(def,'capacity:=(info->>''capacity'')::integer;','info:=info||p_selection;capacity:=(info->>''capacity'')::integer;');
 def:=replace(def,'price:=(info->>(case when public.dynamo_account_is_member(account.id) then ''memberPriceCents'' else ''nonMemberPriceCents'' end))::bigint;','price:=p_price;');
 def:=replace(def,'''pricePence'',price)) returning id into purchase','''pricePence'',price,''selection'',p_selection)) returning id into purchase');
 def:=replace(def,'dynamo_event_bookings(event_id,account_id,gymnast_id,purchase_id,price_pence) values(p_target,p_account,p_gymnast,purchase,price)','dynamo_event_bookings(event_id,account_id,gymnast_id,purchase_id,price_pence,selection) values(p_target,p_account,p_gymnast,purchase,price,p_selection)');
 if position('price:=p_price' in def)=0 or position('book_dynamo_event_priced' in def)=0 then raise exception 'Event price patch failed';end if;execute def;
end $$;
revoke all on function public.book_dynamo_event_priced(text,uuid,uuid,uuid,boolean,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.book_dynamo_event_priced(text,uuid,uuid,uuid,boolean,uuid,bigint,jsonb) to service_role;
create or replace function public.checkout_dynamo_basket(p_account uuid,p_items jsonb,p_credit boolean,p_operation uuid,p_expected_total bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.dynamo_basket_checkouts%rowtype;item jsonb;expanded jsonb:='[]';result jsonb;results jsonb:='[]';expected bigint:=0;price bigint;member boolean;snapshot jsonb;
begin
 perform pg_advisory_xact_lock(719442004);
 select * into prior from public.dynamo_basket_checkouts where id=p_operation;
 if found then if prior.account_id<>p_account or prior.items<>p_items then raise exception 'OPERATION_CONFLICT';end if;return prior.result;end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>50 then raise exception 'INVALID_BOOKING';end if;
 select public.dynamo_account_is_member(id) into member from public.dynamo_accounts where id=p_account for update;
 for item in select value from jsonb_array_elements(p_items) loop expanded:=expanded||public.dynamo_expand_event_selection(p_account,item);end loop;
 if jsonb_array_length(expanded)>50 then raise exception 'TOO_MANY_TICKETS';end if;
 for item in select value from jsonb_array_elements(expanded) loop
 if item->>'kind'='event' then price:=(item->>'_pricePence')::bigint;else price:=public.dynamo_party_price((item->>'targetId')::uuid,member,coalesce((item->>'roomAddon')::boolean,false));end if;
 if price is null then raise exception 'SESSION_UNAVAILABLE';end if;expected:=expected+price;end loop;
 if p_expected_total is null or expected<>p_expected_total then raise exception 'PRICE_CHANGED';end if;
 for item in select value from jsonb_array_elements(expanded) loop
 snapshot:=public.validate_dynamo_booking_answers(p_account,item);
 if item->>'kind'='party' then result:=public.book_dynamo_session_v2('party',(item->>'targetId')::uuid,p_account,(item->>'gymnastId')::uuid,p_credit,gen_random_uuid(),coalesce((item->>'roomAddon')::boolean,false));else result:=public.book_dynamo_event_priced('event',(item->>'targetId')::uuid,p_account,(item->>'gymnastId')::uuid,p_credit,gen_random_uuid(),(item->>'_pricePence')::bigint,item->'_selection');end if;
 results:=results||jsonb_build_array(result);
 if item->>'kind'='event' then update public.dynamo_event_bookings set responses=snapshot->'answers',medical_snapshot=snapshot->>'medical' where id=(result->>'bookingId')::uuid;else update public.dynamo_party_bookings set medical_snapshot=snapshot->>'medical' where id=(result->>'bookingId')::uuid;end if;
 end loop;
 result:=jsonb_build_object('ok',true,'bookings',results);
 insert into public.dynamo_basket_checkouts(id,account_id,items,result) values(p_operation,p_account,p_items,result);
 insert into public.dynamo_confirmation_jobs(id,account_id,booking_ids) values(p_operation,p_account,array(select (v->>'bookingId')::uuid from jsonb_array_elements(results) v));return result;
end $$;
commit;
