-- This recovery sweep never sends mail. Uncertain SMTP attempts require human review.
CREATE OR REPLACE FUNCTION public.recover_dynamo_email_status() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 UPDATE public.dynamo_confirmation_jobs SET status='review',error_code='EMAIL_DELIVERY_UNCONFIRMED'
 WHERE status='sending' AND attempted_at<now()-interval '10 minutes';
 UPDATE public.dynamo_party_alerts SET status='review',error_code='EMAIL_DELIVERY_UNCONFIRMED'
 WHERE status='sending' AND attempted_at<now()-interval '10 minutes';
 UPDATE public.dynamo_manual_confirmations SET status='review',finished_at=now()
 WHERE status='sending' AND created_at<now()-interval '10 minutes';
END $$;
REVOKE ALL ON FUNCTION public.recover_dynamo_email_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recover_dynamo_email_status() TO service_role;
SELECT cron.schedule('dynamo-email-status-recovery','*/5 * * * *','select public.recover_dynamo_email_status();');
