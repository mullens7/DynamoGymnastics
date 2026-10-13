begin;
do $test$
declare owner uuid:=gen_random_uuid();gym uuid:=gen_random_uuid();event uuid:=gen_random_uuid();operation uuid:=gen_random_uuid();fields jsonb:='[{"id":"terms","label":"Parent led","type":"acknowledgement","required":true,"options":[]},{"id":"shirt","label":"T-shirt size","type":"dropdown","required":true,"options":["S","M"]},{"id":"phone","label":"Emergency contact","type":"phone","required":true,"options":[]}]';item jsonb;result jsonb;booking uuid;
begin
 insert into public.dynamo_accounts(id,email,owner_name) values(owner,'booking-fields-'||owner::text||'@example.invalid','Fixture Parent');
 insert into public.dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,groups,active) values(gym,owner,'manual:'||gym::text,'Fixture','Child','2020-01-01','{}',false);
 insert into public.dynamo_events(id,details) values(event,jsonb_build_object('name','Fixture event','date','2030-01-01','time','10:00','capacity',5,'status','Published','audience','everyone','memberPriceCents',0,'nonMemberPriceCents',0,'bookingFields',fields));
 item:=jsonb_build_object('kind','event','targetId',event,'gymnastId',gym,'fieldDefinitions',fields,'answers',jsonb_build_object('terms',true,'shirt','S','phone','07712345678'));
 begin perform public.checkout_dynamo_basket(owner,jsonb_build_array(item),false,operation,0);raise exception 'Missing medical accepted';exception when others then if sqlerrm<>'MEDICAL_REQUIRED' then raise;end if;end;
 item:=item||'{"medicalNone":true}';
 begin perform public.checkout_dynamo_basket(owner,jsonb_build_array(jsonb_set(item,'{answers,terms}','false')),false,operation,0);raise exception 'Missing consent accepted';exception when others then if sqlerrm<>'BOOKING_DATA_REQUIRED' then raise;end if;end;
 if (select medical_details from public.dynamo_gymnasts where id=gym) is not null then raise exception 'Failed booking changed medical profile';end if;
 begin perform public.checkout_dynamo_basket(owner,jsonb_build_array(jsonb_set(item,'{answers,shirt}','"Invalid"')),false,operation,0);raise exception 'Invalid option accepted';exception when others then if sqlerrm<>'BOOKING_DATA_REQUIRED' then raise;end if;end;
 begin perform public.checkout_dynamo_basket(owner,jsonb_build_array(jsonb_set(item,'{fieldDefinitions}','[]')),false,operation,0);raise exception 'Changed fields accepted';exception when others then if sqlerrm<>'BOOKING_FIELDS_CHANGED' then raise;end if;end;
 result:=public.checkout_dynamo_basket(owner,jsonb_build_array(item),false,operation,0);booking:=(result->'bookings'->0->>'bookingId')::uuid;
 if not exists(select 1 from public.dynamo_event_bookings where id=booking and medical_snapshot='None' and jsonb_array_length(responses)=3) then raise exception 'Booking snapshots missing';end if;
 if (select medical_details from public.dynamo_gymnasts where id=gym)<>'None' then raise exception 'Medical profile not saved';end if;
 perform public.checkout_dynamo_basket(owner,jsonb_build_array(item),false,operation,0);
 if (select count(*) from public.dynamo_event_bookings where event_id=event)<>1 then raise exception 'Retry duplicated booking';end if;
 update public.dynamo_gymnasts set groups='{}',active=false where id=gym;
 if (select medical_details from public.dynamo_gymnasts where id=gym)<>'None' then raise exception 'Roster update lost medical';end if;
end $test$;
rollback;
