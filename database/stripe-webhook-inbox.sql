CREATE TABLE public.dynamo_stripe_events (
 id text PRIMARY KEY CHECK(id ~ '^evt_[A-Za-z0-9]+$'),
 account_id text NOT NULL CHECK(account_id ~ '^acct_[A-Za-z0-9]+$'),
 event_type text NOT NULL,livemode boolean NOT NULL,payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','processing','processed','review')),
 received_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz,error_code text
);
ALTER TABLE public.dynamo_stripe_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dynamo_stripe_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.dynamo_stripe_events TO service_role;
CREATE INDEX dynamo_stripe_events_pending ON public.dynamo_stripe_events(received_at) WHERE status='received';
