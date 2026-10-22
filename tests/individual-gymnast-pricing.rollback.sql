begin;set local role service_role;
do $$
declare a uuid:=gen_random_uuid();other uuid:=gen_random_uuid();m uuid:=gen_random_uuid();s1 uuid:=gen_random_uuid();s2 uuid:=gen_random_uuid();e uuid:=gen_random_uuid();p uuid:=gen_random_uuid();p2 uuid:=gen_random_uuid();parent uuid:=gen_random_uuid();opt uuid:=gen_random_uuid();pack uuid:=gen_random_uuid();op uuid:=gen_random_uuid();item jsonb;result jsonb;cfg jsonb;before_wallet bigint;
begin
 insert into public.dynamo_accounts(id,email,roster_member,wallet_pence) values(a,'individual-test-'||a||'@example.invalid',true,100000),(other,'other-test-'||other||'@example.invalid',true,0);
 insert into public.dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,groups,active,medical_details) values(m,a,'fixture:'||m,'Member','Fixture','2020-01-01','{gymini}',true,'None'),(s1,a,'manual:'||s1,'Sibling','One','2020-01-01','{}',false,'None'),(s2,a,'manual:'||s2,'Sibling','Two','2020-01-01','{gymini}',false,'None');
 if not public.dynamo_gymnast_is_member(a,m) or public.dynamo_gymnast_is_member(a,s1) or public.dynamo_gymnast_is_member(a,s2) or public.dynamo_gymnast_is_member(other,m) then raise exception 'MEMBERSHIP_OWNERSHIP';end if;
 insert into public.dynamo_events(id,details) values(e,jsonb_build_object('name','Pricing fixture','status','Published','audience','everyone','date','2030-01-08','time','16:00','endTime','17:00','capacity',10,'memberPriceCents',1000,'nonMemberPriceCents',1500,'bookingFields','[]'::jsonb));
 result:=public.checkout_dynamo_basket(a,jsonb_build_array(jsonb_build_object('kind','event','targetId',e,'gymnastId',m,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb),jsonb_build_object('kind','event','targetId',e,'gymnastId',s1,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb),jsonb_build_object('kind','event','targetId',e,'gymnastId',s2,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb)),true,op,4000);
 if(select sum(price_pence) from public.dynamo_event_bookings where event_id=e)<>4000 or not exists(select 1 from public.dynamo_event_bookings where event_id=e and gymnast_id=m and price_pence=1000) or (select count(*) from public.dynamo_event_bookings where event_id=e and gymnast_id in(s1,s2) and price_pence=1500)<>2 then raise exception 'MIXED_BASKET_PRICE';end if;
 cfg:=jsonb_build_object('name','Options fixture','slug','fixture-'||parent,'status','Published','audience','everyone','memberPriceCents',1000,'nonMemberPriceCents',1500,'bookingFields','[]'::jsonb,'sessions',jsonb_build_array(jsonb_build_object('id',p,'date','2030-01-09','time','08:30','endTime','15:30','capacity',10),jsonb_build_object('id',p2,'date','2030-01-10','time','08:30','endTime','15:30','capacity',10)),'pricingOptions',jsonb_build_array(jsonb_build_object('id',opt,'name','Half day','enabled',true,'startTime','08:30','endTime','12:00','memberPriceCents',500,'nonMemberPriceCents',750)),'packages',jsonb_build_array(jsonb_build_object('id',pack,'name','Two days','enabled',true,'memberPriceCents',800,'nonMemberPriceCents',1200,'items',jsonb_build_array(jsonb_build_object('sessionId',p,'optionId',opt),jsonb_build_object('sessionId',p2,'optionId',opt)))));
 insert into public.dynamo_events(id,details) values(parent,cfg);perform public.save_dynamo_event(parent,cfg,false);
 item:=jsonb_build_object('kind','event','targetId',p,'gymnastId',s1,'optionId',opt);
 if (public.dynamo_expand_event_selection(a,item)->0->>'_pricePence')::bigint<>750 then raise exception 'SIBLING_OPTION_PRICE';end if;
 if (public.dynamo_expand_event_selection(a,item||jsonb_build_object('gymnastId',m))->0->>'_pricePence')::bigint<>500 then raise exception 'MEMBER_OPTION_PRICE';end if;
 item:=jsonb_build_object('kind','event','targetId',parent,'gymnastId',s1,'packageId',pack);
 if (select sum((v->>'_pricePence')::bigint) from jsonb_array_elements(public.dynamo_expand_event_selection(a,item)) v)<>1200 then raise exception 'SIBLING_PACKAGE_PRICE';end if;
 if (select sum((v->>'_pricePence')::bigint) from jsonb_array_elements(public.dynamo_expand_event_selection(a,item||jsonb_build_object('gymnastId',m))) v)<>800 then raise exception 'MEMBER_PACKAGE_PRICE';end if;
 -- A parent with a manually granted account status still cannot give siblings a discount.
 update public.dynamo_accounts set manual_member=true where id=a;
 if public.dynamo_gymnast_is_member(a,s1) then raise exception 'ACCOUNT_OVERRIDE_LEAK';end if;
 update public.dynamo_party_types set details=details||jsonb_build_object('memberPriceCents',20000,'nonMemberPriceCents',25000,'roomMemberPriceCents',2000,'roomNonMemberPriceCents',3000,'addonEnabled',true,'roomIncluded',false,'enabled',true,'day',6,'times',jsonb_build_array('14:30'),'activityMinutes',60,'roomMinutes',30,'guests',25,'includedChildren',25,'extraChildPriceCents',0,'bookingFields','[]'::jsonb) where id='preschool';
 p:=gen_random_uuid();p2:=gen_random_uuid();insert into public.dynamo_parties(id,details) values(p,'{"name":"Member party","partyType":"preschool","date":"2030-01-12","time":"14:30","room":"Small gym","status":"Pending"}'),(p2,'{"name":"Sibling party","partyType":"preschool","date":"2030-01-19","time":"14:30","room":"Small gym","status":"Pending"}');
 item:=jsonb_build_object('kind','party','targetId',p,'gymnastId',m,'roomAddon',true,'partyDetails',jsonb_build_object('contactNumber','07712345678','numberOfChildren',20),'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb);
 perform public.checkout_dynamo_basket(a,jsonb_build_array(item),true,gen_random_uuid(),22000);
 item:=item||jsonb_build_object('targetId',p2,'gymnastId',s1);
 begin perform public.checkout_dynamo_basket(a,jsonb_build_array(item),true,gen_random_uuid(),22000);raise exception 'EXPECTED_PRICE_REJECTION';exception when others then if sqlerrm<>'PRICE_CHANGED' then raise;end if;end;
 result:=public.prepare_dynamo_card_checkout(a,'basket',jsonb_build_array(item),false,gen_random_uuid(),28000,'acct_fixture','https://dynamogymnastics.co.uk');
 if (result->>'card_pence')::bigint<>28000 then raise exception 'CARD_SIBLING_PARTY_PRICE';end if;
 if not exists(select 1 from public.dynamo_party_bookings where party_id=p2 and gymnast_id=s1 and price_pence=28000 and payment_pending) then raise exception 'SIBLING_PARTY_PRICE';end if;
end $$;
rollback;
