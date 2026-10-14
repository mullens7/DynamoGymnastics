# Stripe webhook setup

This release adds verified, durable receipt of the nine configured Connect events. It does not yet enable card checkout, fulfil bookings, refund payments or send emails. Incoming events remain in a private inbox for the payment integration's next stage. Do not mark payments launch-ready based on webhook receipt alone.

Use Mullens Ltd's Stripe dashboard. Scope: Connected accounts. Payload: Snapshot. API version: 2026-04-22.dahlia. Destination name: Dynamo Gymnastics Website.

Endpoint: `https://dynamo-gymnastics.vercel.app/api/stripe-webhook/` (the trailing slash avoids a redirect).

Events:

- checkout.session.completed
- checkout.session.expired
- checkout.session.async_payment_succeeded
- checkout.session.async_payment_failed
- payment_intent.payment_failed
- charge.refunded
- refund.created
- refund.updated
- refund.failed

Copy the destination's signing secret directly into Production Vercel environment variable STRIPE_WEBHOOK_SECRET. Also configure STRIPE_SECRET_KEY (Mullens Ltd platform key) and STRIPE_CONNECTED_ACCOUNT_ID (Dynamo acct_ ID), then redeploy.

Only the configured connected account and matching live/test mode are stored. Other platform clients' events are acknowledged and ignored. A signature is verified against the original bytes with the Stripe SDK and five-minute tolerance. Storage uses an immutable primary event ID; duplicate deliveries do not overwrite existing state. Failed storage returns 503 so Stripe can retry. Invalid signatures return 400. No keys or webhook payloads are logged.

Do not send test emails or take live payments during setup. Real end-to-end payment/refund testing remains necessary when checkout and fulfilment are implemented.
