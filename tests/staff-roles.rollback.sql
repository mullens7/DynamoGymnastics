begin;
do $test$
declare actor uuid; manual_id uuid; planner uuid; event_id uuid; booking uuid; response jsonb;
begin
 select id into actor from public.dynamo_accounts where email='freddie@dynamogymnastics.co.uk';
 insert into public.dynamo_accounts(email,owner_name,roster_member,wallet_pence) values('staff-role-fixture@example.invalid','Existing Parent',true,1234) returning id into manual_id;
 if public.save_dynamo_staff(null,'staff-role-fixture@example.invalid','Manual','Staff','check_in',true,true,actor)<>manual_id then raise exception 'Existing account was replaced';end if;
 if not exists(select 1 from public.dynamo_accounts where id=manual_id and owner_name='Existing Parent' and roster_member and wallet_pence=1234) then raise exception 'Parent account changed';end if;
 update public.dynamo_accounts set roster_staff=false where id=manual_id;
 if not exists(select 1 from public.dynamo_staff_profiles s join public.dynamo_accounts a on a.id=s.account_id where a.id=manual_id and s.enabled and s.manual_staff and s.role='check_in') then raise exception 'Manual staff lost during roster removal';end if;
 planner:=public.save_dynamo_staff(null,'planner-role-fixture@example.invalid','Test','Planner','staff_planner',true,true,actor);
 begin perform public.save_dynamo_staff(null,'unauthorised-staff-fixture@example.invalid','No','Access','super_admin',true,true,planner);raise exception 'Planner granted roles';exception when others then if sqlerrm<>'STAFF_FORBIDDEN' then raise;end if;end;
 insert into public.dynamo_events(details) values('{"name":"Role fixture","date":"2030-01-01","time":"10:00","capacity":10,"status":"Published","audience":"everyone","memberPriceCents":0,"nonMemberPriceCents":0}'::jsonb) returning id into event_id;
 insert into public.dynamo_event_bookings(event_id,account_id,status,price_pence) values(event_id,manual_id,'Booked',0) returning id into booking;
 response:=public.check_in_dynamo_attendee(booking,true,manual_id);
 if response->>'checkedInAt' is null then raise exception 'Check-in not saved';end if;
 response:=public.check_in_dynamo_attendee(booking,false,manual_id);
 if response->>'checkedInAt' is not null then raise exception 'Check-in not undone';end if;
 begin perform public.check_in_dynamo_attendee(booking,true,planner);raise exception 'Planner checked in attendee';exception when others then if sqlerrm<>'STAFF_FORBIDDEN' then raise;end if;end;
 update public.dynamo_staff_profiles set enabled=false where account_id=manual_id;
 begin perform public.check_in_dynamo_attendee(booking,true,manual_id);raise exception 'Disabled staff retained access';exception when others then if sqlerrm<>'STAFF_FORBIDDEN' then raise;end if;end;
 update public.dynamo_staff_profiles set enabled=false where role='super_admin' and account_id<>actor;
 begin perform public.save_dynamo_staff(actor,null,'Freddie','','staff',true,false,actor);raise exception 'Last admin was demoted';exception when others then if sqlerrm<>'LAST_SUPER_ADMIN' then raise;end if;end;
end $test$;
rollback;
