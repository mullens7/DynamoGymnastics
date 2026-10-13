begin;
do $test$
declare owner uuid:=gen_random_uuid();gym uuid:=gen_random_uuid();othergym uuid:=gen_random_uuid();parent uuid:=gen_random_uuid();fullid uuid:=gen_random_uuid();halfid uuid:=gen_random_uuid();packid uuid:=gen_random_uuid();sessions jsonb:='[]';includes jsonb:='[]';cfg jsonb;sessionid uuid;firstsession uuid;item jsonb;result jsonb;expanded jsonb;operation uuid:=gen_random_uuid();
begin
 insert into public.dynamo_accounts(id,email,roster_member,wallet_pence) values(owner,'option-fixture-'||owner::text||'@example.invalid',true,20000);
 insert into public.dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,medical_details,groups,active) values(gym,owner,'manual:'||gym::text,'Example','Child','2020-01-01','None','{}',false),(othergym,owner,'manual:'||othergym::text,'Other','Child','2020-01-01','None','{}',false);
 for i in 1..5 loop sessionid:=gen_random_uuid();if i=1 then firstsession:=sessionid;end if;sessions:=sessions||jsonb_build_array(jsonb_build_object('id',sessionid,'date',('2030-01-07'::date+i-1)::text,'time','08:30','endTime','15:30','capacity',1,'label','','minAge',null,'maxAge',null));includes:=includes||jsonb_build_array(jsonb_build_object('sessionId',sessionid,'optionId',fullid));end loop;
 cfg:=jsonb_build_object('name','Day Camp','slug','fixture-'||parent::text,'status','Published','audience','everyone','allowedGroups','[]'::jsonb,'memberPriceCents',3500,'nonMemberPriceCents',4000,'bookingFields','[]'::jsonb,'sessions',sessions,'pricingOptions',jsonb_build_array(jsonb_build_object('id',fullid,'name','Full day','enabled',true,'startTime','08:30','endTime','15:30','memberPriceCents',3500,'nonMemberPriceCents',4000),jsonb_build_object('id',halfid,'name','Half day','enabled',true,'startTime','08:30','endTime','12:00','memberPriceCents',2000,'nonMemberPriceCents',2500)),'packages',jsonb_build_array(jsonb_build_object('id',packid,'name','Full week','enabled',true,'memberPriceCents',15000,'nonMemberPriceCents',17500,'items',includes)));
 insert into public.dynamo_events(id,details) values(parent,cfg);perform public.save_dynamo_event(parent,cfg,false);
 item:=jsonb_build_object('kind','event','targetId',firstsession,'optionId',halfid,'gymnastId',gym,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb);
 result:=public.checkout_dynamo_basket(owner,jsonb_build_array(item),true,operation,2000);
 if (select wallet_pence from public.dynamo_accounts where id=owner)<>18000 then raise exception 'Wrong half-day charge';end if;
 if not exists(select 1 from public.dynamo_event_bookings where account_id=owner and price_pence=2000 and selection->>'optionName'='Half day' and selection->>'endTime'='12:00') then raise exception 'Option snapshot lost';end if;
 begin perform public.checkout_dynamo_basket(owner,jsonb_build_array(item||jsonb_build_object('optionId',fullid,'gymnastId',othergym)),true,gen_random_uuid(),3500);raise exception 'Separate option capacity incorrectly allowed';exception when others then if sqlerrm<>'SESSION_FULL' then raise;end if;end;
 item:=jsonb_build_object('kind','event','targetId',parent,'packageId',packid,'gymnastId',othergym,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb);
 begin perform public.checkout_dynamo_basket(owner,jsonb_build_array(item),true,gen_random_uuid(),15000);raise exception 'Full package with unavailable day accepted';exception when others then if sqlerrm<>'SESSION_FULL' then raise;end if;end;
 if (select count(*) from public.dynamo_event_bookings where account_id=owner)<>1 or (select wallet_pence from public.dynamo_accounts where id=owner)<>18000 then raise exception 'Failed package partly applied';end if;
 update public.dynamo_event_bookings set status='Cancelled' where account_id=owner;
 begin perform public.checkout_dynamo_basket(owner,jsonb_build_array(item),true,gen_random_uuid(),1);raise exception 'Forged package price accepted';exception when others then if sqlerrm<>'PRICE_CHANGED' then raise;end if;end;
 result:=public.checkout_dynamo_basket(owner,jsonb_build_array(item),true,gen_random_uuid(),15000);
 if jsonb_array_length(result->'bookings')<>5 or (select wallet_pence from public.dynamo_accounts where id=owner)<>3000 then raise exception 'Wrong package charge or ticket count';end if;
 if (select sum(price_pence) from public.dynamo_event_bookings where account_id=owner and status='Booked')<>15000 or (select count(distinct ticket_number) from public.dynamo_event_bookings where account_id=owner and status='Booked')<>5 then raise exception 'Package allocation or tickets wrong';end if;
 update public.dynamo_accounts set roster_member=false where id=owner;
 expanded:=public.dynamo_expand_event_selection(owner,item||'{"_pricePence":1}');
 if (select sum((v->>'_pricePence')::integer) from jsonb_array_elements(expanded) v)<>17500 then raise exception 'Non-member package price incorrect';end if;
end $test$;
rollback;
