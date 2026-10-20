begin;
do $test$
declare actor uuid:=gen_random_uuid();owner uuid:=gen_random_uuid();gym uuid:=gen_random_uuid();event uuid:=gen_random_uuid();booking uuid:=gen_random_uuid();fields jsonb;answers jsonb;bad jsonb;result jsonb;before_time timestamptz;begin
 insert into public.dynamo_accounts(id,email,owner_name) values(actor,'checkin-actor-'||actor||'@example.invalid','Example Staff'),(owner,'checkin-owner-'||owner||'@example.invalid','Example Parent');
 insert into public.dynamo_staff_profiles(account_id,first_name,last_name,role,roles,manual_staff,enabled) values(actor,'Example','Staff','check_in',array['check_in','party_staff'],true,true);
 insert into public.dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,groups,active) values(gym,owner,'manual:'||gym,'Example','Child','2020-01-01','{}',false);
 fields:='[{"id":"phone","label":"Emergency contact","type":"phone","required":true,"options":[],"checkInVisible":true},{"id":"shirt","label":"Shirt","type":"dropdown","options":["S","M"],"required":true,"checkInVisible":true},{"id":"terms","label":"Parent acknowledgement","type":"acknowledgement","options":[],"required":true,"checkInVisible":true},{"id":"select","label":"Choose","type":"multiselect","options":["A","B"],"required":false,"checkInVisible":true},{"id":"day","label":"Date","type":"date","options":[],"required":true,"checkInVisible":true},{"id":"short","label":"Short","type":"short_text","options":[],"required":true,"checkInVisible":true},{"id":"long","label":"Long","type":"long_text","options":[],"required":true,"checkInVisible":true},{"id":"private","label":"Hidden","type":"short_text","options":[],"required":true,"checkInVisible":false}]';
 answers:='{"phone":"07123456789","shirt":"S","terms":true,"select":["A"],"day":"2030-01-01","short":"Test","long":"Example details"}';
 insert into public.dynamo_events(id,details) values(event,jsonb_build_object('name','Check-in fixture','date','2030-01-01','time','10:00','status','Published','capacity',5,'bookingFields',fields));
 insert into public.dynamo_event_bookings(id,event_id,account_id,gymnast_id,status,price_pence,responses) values(booking,event,owner,gym,'Booked',0,'[{"id":"private","label":"Hidden","type":"short_text","value":"Original private answer"}]');
 result:=public.complete_dynamo_event_checkin(booking,event,true,actor);
 if result->>'needsDetails'<>'true' or jsonb_array_length(result->'fields')<>7 or result->>'needsMedical'<>'true' or result::text like '%Original private%' or result::text like '%"id": "private"%' then raise exception 'Missing fields projection incorrect';end if;
 if exists(select 1 from public.dynamo_event_bookings where id=booking and checked_in_at is not null) then raise exception 'Missing details allowed check-in';end if;
 result:=public.check_in_dynamo_attendee(booking,true,actor);
 if result->>'needsDetails'<>'true' then raise exception 'Legacy entry bypassed missing details';end if;
 for bad in select value from jsonb_array_elements('[{"phone":"------"},{"phone":"invalid"},{"phone":""},{"shirt":"XL"},{"terms":false},{"select":[]},{"select":null},{"select":["X"]},{"day":"2030-02-31"},{"short":""},{"long":""}]') loop
 begin
 perform public.complete_dynamo_event_checkin(booking,event,true,actor,answers||bad,'None');raise exception 'Invalid answer accepted';
 exception when others then if sqlerrm<>'CHECKIN_DETAILS_INVALID' then raise;end if;end;
 end loop;
 begin perform public.complete_dynamo_event_checkin(booking,event,true,actor,answers||'{"private":"Changed"}','None');raise exception 'Hidden field altered';exception when others then if sqlerrm<>'CHECKIN_DETAILS_CHANGED' then raise;end if;end;
 if (select jsonb_array_length(responses) from public.dynamo_event_bookings where id=booking)<>1 or (select medical_details from public.dynamo_gymnasts where id=gym) is not null then raise exception 'Partial answers saved';end if;
 begin perform public.complete_dynamo_event_checkin(booking,gen_random_uuid(),true,actor,answers,'None');raise exception 'Wrong session allowed';exception when others then if sqlerrm<>'BOOKING_NOT_FOUND' then raise;end if;end;
 begin perform public.complete_dynamo_event_checkin(booking,event,true,owner,answers,'None');raise exception 'Customer checked in attendee';exception when others then if sqlerrm<>'STAFF_FORBIDDEN' then raise;end if;end;
 result:=public.complete_dynamo_event_checkin(booking,event,true,actor,answers,'None');
 if result->>'checkedInAt' is null then raise exception 'Check-in not saved';end if;
 select checked_in_at into before_time from public.dynamo_event_bookings where id=booking;
 if (select medical_details from public.dynamo_gymnasts where id=gym)<>'None' then raise exception 'Medical profile not saved';end if;
 if (select count(*) from public.dynamo_event_bookings b cross join lateral jsonb_array_elements(b.responses) a where b.id=booking and a->>'collectedAtCheckIn'='true' and a->>'collectedBy'=actor::text)<>7 then raise exception 'Check-in answers not audited';end if;
 result:=public.complete_dynamo_event_checkin(booking,event,true,actor,answers,'None');
 if result->>'alreadyCheckedIn'<>'true' or (select checked_in_at from public.dynamo_event_bookings where id=booking)<>before_time or (select jsonb_array_length(responses) from public.dynamo_event_bookings where id=booking)<>8 then raise exception 'Retry changed the record';end if;
 result:=public.complete_dynamo_event_checkin(booking,event,false,actor);
 if result->>'checkedInAt' is not null or (select jsonb_array_length(responses) from public.dynamo_event_bookings where id=booking)<>8 then raise exception 'Undo lost answers';end if;
 result:=public.complete_dynamo_event_checkin(booking,event,true,actor);
 if result->>'checkedInAt' is null or result->>'needsDetails'='true' then raise exception 'Existing answers asked again';end if;
 update public.dynamo_event_bookings set payment_pending=true where id=booking;
 begin perform public.complete_dynamo_event_checkin(booking,event,true,actor);raise exception 'Unpaid booking allowed';exception when others then if sqlerrm<>'PAYMENT_PENDING' then raise;end if;end;
 update public.dynamo_event_bookings set payment_pending=false,status='Cancelled' where id=booking;
 begin perform public.complete_dynamo_event_checkin(booking,event,true,actor);raise exception 'Cancelled booking allowed';exception when others then if sqlerrm<>'BOOKING_NOT_FOUND' then raise;end if;end;
 if exists(select 1 from public.dynamo_confirmation_jobs where account_id=owner) then raise exception 'Notification queued';end if;
end $test$;
rollback;
