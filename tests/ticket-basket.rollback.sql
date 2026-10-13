begin;
do $test$
declare owner uuid:=gen_random_uuid();gym uuid:=gen_random_uuid();event uuid;operation uuid:=gen_random_uuid();items jsonb:='[]';result jsonb;begin
 insert into public.dynamo_accounts(id,email,owner_name) values(owner,'ticket-fixture-'||owner::text||'@example.invalid','Example Parent');
 insert into public.dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,medical_details,groups,active) values(gym,owner,'manual:'||gym::text,'Example','Child','2020-01-01','None','{}',false);
 for i in 1..6 loop event:=gen_random_uuid();insert into public.dynamo_events(id,details) values(event,jsonb_build_object('name','Activity '||i,'date','2030-01-01','time','10:00','capacity',5,'status','Published','audience','everyone','memberPriceCents',0,'nonMemberPriceCents',0));items:=items||jsonb_build_array(jsonb_build_object('kind','event','targetId',event,'gymnastId',gym,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb));end loop;
 result:=public.checkout_dynamo_basket(owner,items,false,operation,0);
 if jsonb_array_length(result->'bookings')<>6 then raise exception 'Six bookings missing';end if;
 if (select count(distinct ticket_number) from public.dynamo_event_bookings where account_id=owner)<>6 then raise exception 'Six distinct tickets missing';end if;
 if not exists(select 1 from public.dynamo_confirmation_jobs where id=operation and cardinality(booking_ids)=6 and status='pending') then raise exception 'Single six-ticket email job missing';end if;
 perform public.checkout_dynamo_basket(owner,items,false,operation,0);
 if (select count(*) from public.dynamo_confirmation_jobs where account_id=owner)<>1 then raise exception 'Retry queued duplicate email';end if;
end $test$;
rollback;
