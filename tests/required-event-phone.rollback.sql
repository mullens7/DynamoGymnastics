-- Validation only; no booking, payment or notification job is created.
begin;
do $test$
declare owner uuid:=gen_random_uuid();gym uuid:=gen_random_uuid();event uuid:=gen_random_uuid();fields jsonb;item jsonb;snapshot jsonb;bad jsonb;flag boolean;begin
 insert into public.dynamo_accounts(id,email,owner_name) values(owner,'phone-validation-'||owner::text||'@example.invalid','Example Parent');
 insert into public.dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,medical_details,groups,active) values(gym,owner,'manual:'||gym::text,'Example','Child','2020-01-01','None','{}',false);
 insert into public.dynamo_events(id,details) values(event,jsonb_build_object('name','Phone validation fixture','date','2030-01-01','time','10:00','status','Published','capacity',5,'audience','everyone','memberPriceCents',0,'nonMemberPriceCents',0));
 foreach flag in array array[false,true] loop
 fields:=jsonb_build_array(jsonb_build_object('id','emergency','label','Emergency contact number','type','phone','required',true,'options','[]'::jsonb,'checkInVisible',flag));
 update public.dynamo_events set details=details||jsonb_build_object('bookingFields',fields) where id=event;
 item:=jsonb_build_object('kind','event','targetId',event,'gymnastId',gym,'fieldDefinitions',fields,'answers','{}'::jsonb);
 foreach bad in array array['{}'::jsonb,'{"emergency":null}'::jsonb,'{"emergency":""}'::jsonb,'{"emergency":"   "}'::jsonb,'{"emergency":"invalid"}'::jsonb] loop
 begin
 perform public.validate_dynamo_booking_answers(owner,item||jsonb_build_object('answers',bad));
 raise exception 'Required phone validation was bypassed';
 exception when others then if sqlerrm<>'BOOKING_DATA_REQUIRED' then raise;end if;end;
 end loop;
 snapshot:=public.validate_dynamo_booking_answers(owner,item||jsonb_build_object('answers',jsonb_build_object('emergency','07123456789')));
 if snapshot->'answers'->0->>'value'<>'07123456789' then raise exception 'Validated phone not preserved';end if;
 begin
 perform public.validate_dynamo_booking_answers(owner,item||jsonb_build_object('fieldDefinitions','[]'::jsonb));
 raise exception 'Stale form bypassed current required question';
 exception when others then if sqlerrm<>'BOOKING_FIELDS_CHANGED' then raise;end if;end;
 end loop;
 if exists(select 1 from public.dynamo_confirmation_jobs where account_id=owner) then raise exception 'Validation created a notification';end if;
end $test$;
rollback;
