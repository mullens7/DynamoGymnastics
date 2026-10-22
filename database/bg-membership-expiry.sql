alter table public.dynamo_gymnasts add column if not exists bg_expiry_date date;
DO $migration$
declare definition text;
begin
 select pg_get_functiondef(oid) into definition from pg_proc where pronamespace='public'::regnamespace and proname='apply_dynamo_roster';
 if definition is null or strpos(definition,'bg_number,groups,active,time_class)')=0 then raise exception 'Unexpected roster importer definition';end if;
 definition:=replace(definition,'bg_number,groups,active,time_class)','bg_number,groups,active,time_class,bg_expiry_date)');
 definition:=replace(definition,'coalesce(gymnast->>''timeClass'',''''))','coalesce(gymnast->>''timeClass'',''''),nullif(gymnast->>''bgExpiryDate'','''')::date)');
 definition:=replace(definition,'time_class=excluded.time_class;','time_class=excluded.time_class,bg_expiry_date=case when gymnast ? ''bgExpiryDate'' then excluded.bg_expiry_date else dynamo_gymnasts.bg_expiry_date end;');
 if strpos(definition,'nullif(gymnast->>''bgExpiryDate''')=0 then raise exception 'Expiry patch did not match';end if;
 execute definition;
end $migration$;
