-- New OTPs last 15 minutes. Existing issued codes keep their original expiry.
alter table public.dynamo_login_codes alter column expires_at set default (now()+interval '15 minutes');
