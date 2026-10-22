-- Keep private scheduled jobs on the production domain and its current credentials.
do $migration$
declare fn text; definition text;
begin
 foreach fn in array array['dispatch_dynamo_scheduled_sync','dispatch_dynamo_payment_reconciliation'] loop
  select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=fn and p.pronargs=0;
  if definition is null then raise exception 'Missing dispatcher %',fn;end if;
  definition:=replace(definition,'https://dynamo-gymnastics.vercel.app/api/scheduled-sync/','https://dynamogymnastics.co.uk/api/scheduled-sync/');
  execute definition;
 end loop;
end $migration$;
