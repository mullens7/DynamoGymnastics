begin;
do $test$
declare actor uuid:=gen_random_uuid();owner uuid:=gen_random_uuid();other_owner uuid:=gen_random_uuid();gym uuid:=gen_random_uuid();source uuid:=gen_random_uuid();cheap uuid:=gen_random_uuid();expensive uuid:=gen_random_uuid();second uuid:=gen_random_uuid();operation uuid:=gen_random_uuid();book jsonb;input jsonb;quote jsonb;result jsonb;receipt uuid;booking uuid;old_wallet bigint;erase_op uuid:=gen_random_uuid();items jsonb;
begin
 insert into public.dynamo_accounts(id,email,wallet_pence) values(actor,'history-actor-'||actor||'@example.invalid',0),(owner,'history-owner-'||owner||'@example.invalid',5000),(other_owner,'history-other-'||other_owner||'@example.invalid',0);
 insert into public.dynamo_staff_profiles(account_id,manual_staff,role,roles) values(actor,true,'super_admin',array['super_admin']);
 insert into public.dynamo_gymnasts(id,account_id,source_id,first_name,last_name,date_of_birth,medical_details) values(gym,owner,'manual:'||gym,'Example','Child','2020-01-01','None');
 insert into public.dynamo_events(id,details) select v.id,jsonb_build_object('name',v.label,'date','2030-01-01','time','09:00','capacity',3,'status','Published','audience','everyone','allowedGroups','[]'::jsonb,'memberPriceCents',v.price,'nonMemberPriceCents',v.price,'bookingFields','[]'::jsonb,'minAge',1,'maxAge',16) from (values(source,'Source',1250),(cheap,'Cheaper',500),(expensive,'Expensive',1500),(second,'Second',1000)) v(id,label,price);
 input:=jsonb_build_object('email','history-owner-'||owner||'@example.invalid','parentFirstName','Example','parentLastName','Parent','gymnastId',gym,'targetId',source,'paymentStatus','Custom Amount Paid','amountPence',1250,'sendConfirmation',false,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb);
 book:=public.create_dynamo_manual_event_booking(actor,gen_random_uuid(),input);booking:=(book->>'bookingId')::uuid;select purchase_id into receipt from public.dynamo_event_bookings where id=booking;
 quote:=public.quote_dynamo_event_move(actor,booking,cheap,null);if (quote->>'differencePence')::bigint<>750 or (quote->>'refundAvailable')::boolean then raise exception 'Move quote incorrect';end if;
 begin perform public.move_dynamo_event_booking(actor,booking,cheap,null,'refund',1250,500,false,'{}','[]',gen_random_uuid());raise exception 'External refund bypass';exception when others then if sqlerrm<>'CARD_REFUNDS_NOT_CONNECTED' then raise;end if;end;
 if (select event_id from public.dynamo_event_bookings where id=booking)<>source or (select wallet_pence from public.dynamo_accounts where id=owner)<>5000 then raise exception 'Blocked refund partly moved';end if;
 result:=public.move_dynamo_event_booking(actor,booking,cheap,null,'wallet',1250,500,false,'{}','[]',operation);
 if result<>public.move_dynamo_event_booking(actor,booking,cheap,null,'wallet',1250,500,false,'{}','[]',operation) or (select wallet_pence from public.dynamo_accounts where id=owner)<>5750 then raise exception 'Credit wrong or duplicated';end if;
 if (select price_pence from public.dynamo_event_bookings where id=booking)<>500 or (select refunded_pence from public.dynamo_transactions where purchase_id=receipt)<>750 then raise exception 'Revenue not reconciled';end if;
 quote:=public.quote_dynamo_event_move(actor,booking,expensive,null);if (quote->>'paidPence')::bigint<>500 or (quote->>'additionalPence')::bigint<>1000 then raise exception 'Extra price wrong';end if;
 begin perform public.move_dynamo_event_booking(actor,booking,expensive,null,'none',500,1500,false,'{}','[]',gen_random_uuid());raise exception 'Extra price unacknowledged';exception when others then if sqlerrm<>'EXTRA_PAYMENT_ACKNOWLEDGEMENT' then raise;end if;end;
 result:=public.move_dynamo_event_booking(actor,booking,expensive,null,'none',500,1500,true,'{}','[]',gen_random_uuid());if (select wallet_pence from public.dynamo_accounts where id=owner)<>5750 or (select price_pence from public.dynamo_event_bookings where id=booking)<>500 or (result->>'additionalDuePence')::bigint<>1000 then raise exception 'Extra payment auto collected or missing';end if;
 -- Unselected history is retained; cancellation frees the space without deleting any receipt.
 book:=public.create_dynamo_manual_event_booking(actor,gen_random_uuid(),input||jsonb_build_object('targetId',second));perform public.manage_dynamo_booking('event',(book->>'bookingId')::uuid,actor,'cancel',null,null,null,gen_random_uuid());
 if not exists(select 1 from public.dynamo_event_bookings where id=(book->>'bookingId')::uuid and status='Cancelled') then raise exception 'Cancel lost history';end if;
 items:=jsonb_build_array(jsonb_build_object('kind','purchase','id',receipt));
 begin perform public.erase_dynamo_contact_history(other_owner,actor,gen_random_uuid(),items);raise exception 'Other account erased';exception when others then if sqlerrm<>'HISTORY_NOT_FOUND' then raise;end if;end;
 old_wallet:=(select wallet_pence from public.dynamo_accounts where id=owner);result:=public.erase_dynamo_contact_history(owner,actor,erase_op,items);
 if result<>public.erase_dynamo_contact_history(owner,actor,erase_op,items) then raise exception 'Erasure retry failed';end if;
 if exists(select 1 from public.dynamo_event_bookings where id=booking) or exists(select 1 from public.dynamo_purchases where id=receipt) or exists(select 1 from public.dynamo_transactions where purchase_id=receipt) or exists(select 1 from public.dynamo_wallet_ledger where purchase_id=receipt) then raise exception 'Related history remained';end if;
 if (select wallet_pence from public.dynamo_accounts where id=owner)<>old_wallet or not exists(select 1 from public.dynamo_event_bookings where id=(book->>'bookingId')::uuid) or not exists(select 1 from public.dynamo_gymnasts where id=gym) then raise exception 'Erasure altered balance or unrelated records';end if;
 if not exists(select 1 from public.dynamo_erased_operations where id=operation and account_id=owner) then raise exception 'Erasure replay protection missing';end if;

 -- Original wallet payments can be refunded, and partial basket erasure preserves the other ticket/email.
 update public.dynamo_accounts set wallet_pence=10000 where id=owner;
 result:=public.checkout_dynamo_basket(owner,jsonb_build_array(jsonb_build_object('kind','event','targetId',source,'gymnastId',gym,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb),jsonb_build_object('kind','event','targetId',second,'gymnastId',gym,'answers','{}'::jsonb,'fieldDefinitions','[]'::jsonb)),true,gen_random_uuid(),2250);
 booking:=(result->'bookings'->0->>'bookingId')::uuid;select purchase_id into receipt from public.dynamo_event_bookings where id=booking;
 quote:=public.quote_dynamo_event_move(actor,booking,cheap,null);if not (quote->>'refundAvailable')::boolean then raise exception 'Wallet refund not available';end if;
 result:=public.move_dynamo_event_booking(actor,booking,cheap,null,'refund',1250,500,false,'{}','[]',gen_random_uuid());
 if (select wallet_pence from public.dynamo_accounts where id=owner)<>8500 then raise exception 'Original wallet refund incorrect';end if;
 perform public.erase_dynamo_contact_history(owner,actor,gen_random_uuid(),jsonb_build_array(jsonb_build_object('kind','purchase','id',receipt)));
 if not exists(select 1 from public.dynamo_confirmation_jobs where account_id=owner and cardinality(booking_ids)=1) then raise exception 'Other basket ticket/email lost';end if;
 if not exists(select 1 from public.dynamo_event_bookings where event_id=second and account_id=owner and status='Booked') then raise exception 'Other basket booking lost';end if;
 if has_function_privilege('anon','public.erase_dynamo_contact_history(uuid,uuid,uuid,jsonb)','execute') or has_function_privilege('authenticated','public.move_dynamo_event_booking(uuid,uuid,uuid,uuid,text,bigint,bigint,boolean,jsonb,jsonb,uuid)','execute') then raise exception 'Privileged RPC public';end if;
end $test$;
rollback;
