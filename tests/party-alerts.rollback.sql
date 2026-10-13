begin;set local role service_role;
do $test$
declare a uuid:=gen_random_uuid();g uuid:=gen_random_uuid();p uuid:=gen_random_uuid();op uuid:=gen_random_uuid();item jsonb;result jsonb;booking uuid;begin
 insert into public.dynamo_accounts(id,email,wallet_pence) values(a,'party-alert-fixture-'||a||'@example.invalid',50000);
 insert into public.dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,medical_details) values(g,a,'manual:'||g,'Party','Child','2020-01-01','None');
 insert into public.dynamo_parties(id,details) values(p,'{"name":"Fixture party","date":"2030-01-06","time":"13:00","room":"Big gym","partyType":"dynamo","guests":25,"status":"Pending","memberPriceCents":20000,"nonMemberPriceCents":20000}');
 item:=jsonb_build_object('kind','party','targetId',p,'gymnastId',g,'roomAddon',false,'partyDetails',jsonb_build_object('contactNumber','07712 345678','numberOfChildren',10));
 begin perform public.validate_dynamo_party_details(p,item-'partyDetails');raise exception 'Missing contact data accepted';exception when others then if sqlerrm<>'PARTY_DETAILS_REQUIRED' then raise;end if;end;
 begin perform public.validate_dynamo_party_details(p,item||jsonb_build_object('partyDetails',jsonb_build_object('contactNumber','07712 345678','numberOfChildren',9999)));raise exception 'Oversized party accepted';exception when others then if sqlerrm<>'PARTY_CHILD_COUNT' then raise;end if;end;
 result:=public.checkout_dynamo_basket(a,jsonb_build_array(item),true,op,public.dynamo_party_price(p,false,false));booking:=(result->'bookings'->0->>'bookingId')::uuid;
 perform public.checkout_dynamo_basket(a,jsonb_build_array(item),true,op,public.dynamo_party_price(p,false,false));
 if (select count(*) from public.dynamo_party_alerts where booking_id=booking)<>1 then raise exception 'Admin alert missing or duplicated';end if;
 if not exists(select 1 from public.dynamo_party_bookings where id=booking and party_details->>'contactNumber'='07712 345678' and (party_details->>'numberOfChildren')::int=10) then raise exception 'Party print details not retained';end if;
 if has_table_privilege('anon','public.dynamo_party_alerts','select') or has_function_privilege('authenticated','public.validate_dynamo_party_details(uuid,jsonb)','execute') then raise exception 'Print booking data publicly exposed';end if;
end $test$;
rollback;
