ALTER TABLE public.dynamo_sync_jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 3);
CREATE OR REPLACE FUNCTION public.claim_dynamo_sync(p_source text,p_slot text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE job public.dynamo_sync_jobs%rowtype; job_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(719442002);
 IF p_source NOT IN ('manual','scheduled') THEN RAISE EXCEPTION 'INVALID_SOURCE';END IF;
 UPDATE public.dynamo_sync_jobs SET status='failed',finished_at=now(),error_code='SESSION_TIMEOUT'
 WHERE status='running' AND started_at<now()-interval '3 minutes';
 IF p_slot IS NOT NULL THEN
  SELECT * INTO job FROM public.dynamo_sync_jobs WHERE slot=p_slot FOR UPDATE;
  IF FOUND AND (job.status<>'failed' OR job.attempts>=3 OR job.finished_at>now()-interval '2 minutes'
    OR job.error_code NOT IN ('SESSION_TIMEOUT','STEP_TIMEOUT','EXPORT_TIMEOUT','BROWSER_UNAVAILABLE','SYNC_STORAGE_FAILED','AUTOMATION_FAILED')) THEN
   RETURN jsonb_build_object('state','duplicate','status',job.status);END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.dynamo_sync_jobs WHERE status='running') THEN RETURN jsonb_build_object('state','busy');END IF;
 IF job.id IS NOT NULL THEN
  UPDATE public.dynamo_sync_jobs SET status='running',started_at=now(),finished_at=NULL,error_code=NULL,result=NULL,attempts=attempts+1 WHERE id=job.id;
  job_id:=job.id;
 ELSE INSERT INTO public.dynamo_sync_jobs(source,slot) VALUES(p_source,p_slot) RETURNING id INTO job_id;END IF;
 RETURN jsonb_build_object('state','claimed','id',job_id);
END $$;
REVOKE ALL ON FUNCTION public.claim_dynamo_sync(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dynamo_sync(text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.dispatch_dynamo_scheduled_sync() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE local_time timestamp; token text; slot_key text;
BEGIN
 local_time:=now() at time zone 'Europe/London';
 IF extract(hour from local_time) NOT IN (0,12) OR extract(minute from local_time)>10 THEN RETURN NULL;END IF;
 slot_key:=to_char(local_time,'YYYY-MM-DD"T"HH24')||':00-Europe/London';
 IF EXISTS(SELECT 1 FROM public.dynamo_sync_jobs WHERE slot=slot_key AND (status IN ('complete','running') OR attempts>=3)) THEN RETURN NULL;END IF;
 SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name='dynamo_sync_schedule_secret';
 IF token IS NULL THEN RAISE EXCEPTION 'SCHEDULE_NOT_CONFIGURED';END IF;
 RETURN net.http_post(url:='https://dynamogymnastics.co.uk/api/scheduled-sync/',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=150000);
END $$;
REVOKE ALL ON FUNCTION public.dispatch_dynamo_scheduled_sync() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.alter_job(job_id:=(SELECT jobid FROM cron.job WHERE jobname='dynamo-members-uk-midnight-noon'),schedule:='*/5 * * * *');
