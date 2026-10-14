CREATE TABLE public.dynamo_manual_confirmations(
 id uuid PRIMARY KEY, booking_id uuid NOT NULL REFERENCES public.dynamo_event_bookings(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'sending' CHECK(status IN ('sending','sent','review')),
 created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz
);
ALTER TABLE public.dynamo_manual_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dynamo_manual_confirmations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.dynamo_manual_confirmations TO service_role;
CREATE OR REPLACE FUNCTION public.claim_dynamo_manual_confirmation(p_booking uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE prior public.dynamo_manual_confirmations%rowtype;
BEGIN
 PERFORM pg_advisory_xact_lock(719442011);
 SELECT * INTO prior FROM public.dynamo_manual_confirmations WHERE id=p_operation;
 IF FOUND THEN
  IF prior.booking_id<>p_booking THEN RAISE EXCEPTION 'OPERATION_CONFLICT';END IF;
  RETURN jsonb_build_object('state',prior.status);END IF;
 IF EXISTS(SELECT 1 FROM public.dynamo_manual_confirmations WHERE booking_id=p_booking AND created_at>now()-interval '1 minute') THEN RETURN jsonb_build_object('state','busy');END IF;
 IF NOT EXISTS(SELECT 1 FROM public.dynamo_event_bookings WHERE id=p_booking AND status='Booked') THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND';END IF;
 INSERT INTO public.dynamo_manual_confirmations(id,booking_id) VALUES(p_operation,p_booking);
 RETURN jsonb_build_object('state','claimed');
END $$;
REVOKE ALL ON FUNCTION public.claim_dynamo_manual_confirmation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dynamo_manual_confirmation(uuid,uuid) TO service_role;
