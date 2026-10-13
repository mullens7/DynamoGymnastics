begin;set local role service_role;
do $$declare a uuid:=gen_random_uuid();g uuid:=gen_random_uuid();p uuid:=gen_random_uuid();op uuid:=gen_random_uuid();result jsonb;purchase uuid;n integer;begin
 insert into public.dynamo_accounts(id,email,roster_member,wallet_pence) values(a,'party-check-'||a||'@example.invalid',true,50000);
 insert into public.dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,groups,active) values(g,a,'manual:'||g,'Party','Fixture','2024-01-01','{gymini}',true);
 update public.dynamo_party_types set details=details||'{"memberPriceCents":8000,"roomMemberPriceCents":2500,"roomNonMemberPriceCents":3000,"addonEnabled":true}' where id='preschool';
 insert into public.dynamo_parties(id,details) values(p,'{"name":"Fixture party","date":"2030-01-05","time":"14:30","room":"Small gym","guests":15,"status":"Pending","memberPriceCents":1,"nonMemberPriceCents":1}');
 if public.dynamo_party_price(p,true,false)<>8000 or public.dynamo_party_price(p,true,true)<>10500 then raise exception 'settings prices or add-on incorrect';end if;
 begin perform public.checkout_dynamo_basket(a,jsonb_build_array(jsonb_build_object('kind','party','targetId',p,'gymnastId',g,'roomAddon',true)),true,op,8000);raise exception 'addon undercharged';exception when others then if sqlerrm<>'PRICE_CHANGED' then raise;end if;end;
 result:=public.checkout_dynamo_basket(a,jsonb_build_array(jsonb_build_object('kind','party','targetId',p,'gymnastId',g,'roomAddon',true)),true,op,10500);
 perform public.checkout_dynamo_basket(a,jsonb_build_array(jsonb_build_object('kind','party','targetId',p,'gymnastId',g,'roomAddon',true)),true,op,10500);
 if(select wallet_pence from public.dynamo_accounts where id=a)<>39500 then raise exception 'addon debit or retry incorrect';end if;
 select purchase_id into purchase from public.dynamo_party_bookings where party_id=p;
 if not(select (details->>'roomAddon')::boolean from public.dynamo_purchases where id=purchase) or (select (details->>'partyRoomMinutes')::int from public.dynamo_purchases where id=purchase)<>30 then raise exception 'addon history missing';end if;
 result:=public.manage_dynamo_party_slots('create','[{"name":"Fixture Sunday","date":"2030-01-06","time":"13:00","room":"Big gym","guests":25,"status":"Pending","memberPriceCents":22500,"nonMemberPriceCents":22500},{"name":"Fixture Sunday","date":"2030-01-06","time":"14:15","room":"Big gym","guests":25,"status":"Pending","memberPriceCents":22500,"nonMemberPriceCents":22500},{"name":"Fixture Sunday","date":"2030-01-06","time":"15:30","room":"Big gym","guests":25,"status":"Pending","memberPriceCents":22500,"nonMemberPriceCents":22500}]',null,null,'');
 if(result->>'created')::int<>3 then raise exception 'requested Sunday times rejected';end if;
end $$;rollback;
