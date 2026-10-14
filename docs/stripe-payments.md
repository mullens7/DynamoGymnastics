# Stripe card checkout and refunds

Implemented for Dynamo's configured connected account using direct charges and hosted Checkout. New card checkouts collect a Service fee of 2.5% + 20p for Mullens Ltd, separately from Stripe processing fees. The fee applies once to the card remainder, is rounded to the nearest penny, and is deducted from Dynamo’s takings without increasing the customer’s booking total. Existing checkout sessions retain their original fee snapshot. Application fees remain retained on refunds under the existing default refund policy.

- Event baskets (including session options/packages), birthday parties and awards support card payment and partial wallet credit.
- Prices, age, membership, required fields, medical details and party details are validated in the existing database checkout transaction. Bookings are reserved before opening Stripe.
- `payment_pending` reservations consume capacity but cannot be checked in, emailed, moved, independently cancelled or deleted. Their ticket number is withheld from customer responses.
- Card sessions expire after 31 minutes. Only Stripe-confirmed paid/expired status finalises or releases the reservation. Wallet reservations are returned exactly once on expiry. A customer can resume/cancel an open checkout from their account.
- Stripe Session creation, fulfilment and refund requests have persistent operation IDs. A network failure retries the same Stripe idempotency key; uncertain operations beyond the safe retry window require review.
- Stripe payment notifications are signed and account/mode scoped. Fulfilment additionally checks website metadata, Session ID, client reference, currency and amount, and retrieves current status from Stripe.
- Success redirects also reconcile the payment. Five-minute background reconciliation recovers missed events and incomplete requests. Unrelated old Wix/other-client events never fulfil these orders.
- Full/partial refunds are limited to the stored card transaction's remaining balance. Only one new refund per transaction can be in flight. Pending/failed refunds do not count as successfully refunded.
- Cheaper-session moves can credit the wallet or queue an original-card refund atomically with the move. Additional amounts remain flagged as outstanding; moving a booking does not silently charge the customer.
- Stripe Dashboard refunds are reconciled to linked website card transactions. Conflicting/unmatched financial history is placed in review.
- Confirmed event/party payments use existing durable customer confirmation and party PDF alert queues. No email is sent for an unpaid checkout.
- No new API function was added; webhook routing stays `/api/stripe-webhook/`.

## Database installation order

1. `database/stripe-payments.sql`
2. `database/stripe-payment-recovery.sql`
3. `database/stripe-reconciliation.sql`
4. `database/stripe-history-protection.sql`

Applied to Dynamo Supabase during implementation. Existing imported bookings preserved.

## Verification

173 local tests passing, including mocked Stripe creation/refund/fulfilment tests. Database rollback suites exercise card/wallet split, expiry, replay, unpaid check-in/email rejection, over-refund/pending limits, Dashboard refunds, party/award payment and card move refunds under `service_role`.

No real Stripe Checkout Sessions, charges or refunds were created by implementation tests. No real emails sent. A real paid checkout, bank decline/3DS and actual refund remain acceptance tests; configuration/read-only checks do not substitute for those tests.

## Live read-only verification

Production deployment `ec298da` passed 173 tests. Authenticated GET checks returned 200 for account, bookings, payments and Stripe health. The saved credentials access **Dynamo School of Gymnastics UK Ltd**: card payments capability active, charges/payouts enabled, onboarding submitted. An enabled Stripe webhook includes all nine required event types. A malformed signature is rejected with 400; no live signed payment event was generated.

Temporary read-only test access removed. Zero real card checkouts and zero real card refunds exist following verification. The 55 imported bookings remain intact.
