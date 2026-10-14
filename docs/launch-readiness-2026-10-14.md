# Dynamo launch readiness — 14/10/2026

Status: engineering hardening release, ready for controlled acceptance testing. Do not replace Wix yet.

No real emails were sent by the review, test or deployment process. DNS and the Wix website were not changed. Imported bookings were not resent. The application still sends ordinary customer-requested OTPs and booking confirmations when customers use those features.

## Completed

- Party moves reassign a booking to an existing available slot of the same party type and room. The source becomes available, its date/time remains intact, blocked/occupied/overlapping destinations are rejected, and retries preserve one booking and its original agreed price. Cancellation retains history. Changes do not send emails.
- All nine original policy PDFs are hosted with the application; policy links no longer depend on Wix. Legacy `/_files/ugd/` policy paths resolve to the local copies.
- Exact production-host routing is prepared for `auth.dynamogymnastics.co.uk` and `manage.dynamogymnastics.co.uk`. Verified sessions share a secure, HTTP-only domain cookie across the four explicitly allowed Dynamo hosts. Other hosts retain host-only cookies. Duplicate session cookies fail closed. Login return destinations are restricted to approved hosts and pages. API mutations continue to require same-origin requests and current server-side permissions. No domains have been switched or attached as part of this release.
- Scheduled membership sync remains at 00:00 and 12:00 Europe/London. A five-minute dispatcher allows at most three attempts in the first ten minutes of each slot for selected transient failures. Successful slots do not run again. Identity/roster validation failures are not automatically retried. Existing membership/history remains preserved on failure.
- Super Admin dashboard warnings show failed/stale member syncs and confirmation/party alert delivery work requiring review. Existing manual recovery controls remain available.
- A database-only recovery sweep marks email attempts abandoned for over ten minutes as requiring review. It never sends mail. Pending jobs and uncertain delivery require staff review; this release does not blindly retry SMTP.
- Individual participant resends have server-side operation IDs, a one-minute per-booking limit and single-claim delivery. Successful replay cannot send twice. Interrupted attempts require review. Participant and outbox resend buttons now have distinct selectors.
- Every Vercel build runs the test suite before building. Basic security headers and no-index headers for private areas are configured.
- A private, consistent business-data checkpoint was captured: 31 tables / 2,056 records, live columns/constraints/functions, no passwords, OTPs or user-session tokens. Its rows were restored into temporary table copies with corresponding types/checks/unique indexes and compared exactly; temporary copies were rolled back. This checkpoint contains private customer data and is not in GitHub.

## Verification evidence

- 157 local automated tests passed; email/browser services in these tests are mocked, not connected to real recipients.
- Nine existing database rollback suites passed: booking moves/history deletion; roles; party alerts; party add-ons; manual bookings; event options/packages; required fields; awards; and six-ticket basket/outbox creation.
- Additional transactional checks passed for party source/destination/replay/cancellation, scheduled sync cooldown/retry limits/validation protection, and manual-email single claims/cooldown/recovery. Fixtures rolled back.
- Two simultaneous database checkouts competed for the last place: exactly one succeeded, the other returned `SESSION_FULL`, and exactly one booking existed. Both fictional accounts and all generated booking/payment/outbox data were then removed without sending mail.
- Private Dynamo tables/functions have no direct anonymous/authenticated grants. RLS is enabled. Supabase security advisor has informational notices for intentionally server-only tables, with no warning/error findings.
- Existing imported event bookings remain intact. No real accounts, transactions or bookings were deleted by the checks.

## Deployed checks

- Engineering release `21451e83f765d3d239d79fc39ef28608b0a5bf30` reached Vercel READY (`dpl_5E22wEk8kALpULYNqGstWtqQoDSe`) and was assigned to https://dynamo-gymnastics.vercel.app/. The hosted build itself passed all 157 tests.
- Public home, events, classes, parties, gallery, results, contact, policies, auth and management routes returned HTTP 200. Domain-routing script and security headers were present.
- Public browser navigation loaded the three active events and Fun Sessions' six day/time rows, UK weekdays/dates and availability labels.
- An expiring fictional Super Admin session verified the deployed login, management session, contacts/health, bookings and account APIs (HTTP 200, no-store). It did not request an OTP or send mail. Its session/account/staff fixture was removed.
- Browser checks exposed Wednesday 28/10/2026's Under 7's session configured with maximum age 0. The child session and parent listing were corrected to age 7, matching the other Under 7's sessions; all nine existing bookings were retained. The earlier checkpoint remains the stated point-in-time capture before this correction.
- All 55 imported event bookings remain present. Email queues have no pending/review work; manual delivery attempt table is empty after rollback tests. All concurrency/access fixture accounts were removed.
- Runtime log review found Node/Vercel `url.parse()` deprecation warnings; no application exception was found in the inspected release window. This is a limited-window check, not continuous monitoring or proof of no future errors.

## Required before switching Wix

1. Connect and test Stripe: successful/declined/cancelled payments, asynchronous webhooks, retries, full/partial refunds and reconciliation. Paid card checkout/refunds are currently intentionally unavailable.
2. Reconcile a final Wix export after stopping old bookings: every legacy event booking and every existing party/block must be present. The earlier import covers 55 event bookings, not old party bookings. Confirm no bookings arrived after that export.
3. Establish a full database and Storage-file backup, retention and off-project recovery. Rehearse restoring the complete application to an isolated project. The private checkpoint is a useful data recovery aid; its temporary-table restore does not prove foreign-key, Storage, auth/platform or complete disaster recovery.
4. Attach the three domains to the intended Vercel project, preserve Google Workspace MX/TXT records, verify TLS and test real cross-host login/logout. Host-routing/cookie preparation has automated coverage; it cannot be verified at unconnected hostnames yet. Update SITE_URL/MANAGEMENT_URL and email asset/print URL settings for the final hosts as required.
5. Complete real-device acceptance tests below. This review deliberately did not request OTPs, submit enquiries, send confirmations or resend imported tickets.

## Acceptance tests

Use controlled test customers/staff. Enable actual email tests only when separately authorised. Keep Wix serving customers throughout this rehearsal.

| Scenario | Expected result |
| --- | --- |
| iPhone Safari, Android Chrome, desktop and narrow/large text | Menus, forms, basket, calendar and account are readable; no horizontal page overflow or clipped actions. |
| OTP request, resend countdown, wrong/expired/reused code | Four input boxes; 60-second resend limit; 15-minute expiry; failed attempts limited; one verified account. |
| Logged-in public browsing | Full normal website remains available; small wallet balance/account menu; staff links appear only for recognised permitted staff. |
| Mixed member/non-member household | Both children get family member pricing for open activities; only the eligible member child can enter member-only events. |
| Each restricted staff role and combined roles | Only assigned screens and API actions work; no redirect flicker; revoking access takes effect. |
| Member sync twice, then class/member removal | No emails; accounts, wallet, transactions and bookings retained; current benefits update; permanent/dated membership rules honoured. |
| Full/half-day and multi-day package basket | Correct totals, eligibility and required fields; shared session capacity; retry/refresh cannot duplicate purchases. |
| Party booking, blocking, move and cancellation | One booking per slot; correct room/add-on/time; original slot freed by move/cancel; history retained; expected PDF available. |
| Event check-in | Select session first; its attendees only; wrong-session QR rejected; duplicate scans do not double-check in. |
| Awards, gallery, results and classes | Admin changes persist and appear correctly on public pages; awards remain direct-link/member-gated. |
| Customer/party confirmation recovery | Review statuses visible; staff check inbox before uncertain resend; one basket contains every ticket. Test only after email authorisation. |

## Cutover and rollback

- Before cutover, record the current Wix DNS values, the tested Vercel deployment ID, backup time and final migration counts. Choose a booking freeze window and communicate it through the club's normal process separately.
- Keep Wix intact and do not cancel it during the initial launch period.
- Change only the required web records; preserve email records. Verify HTTPS, public navigation, customer login and staff access at the actual hostnames before reopening bookings.
- If the new website has a serious issue, stop new bookings and restore the previous web DNS / promote the previous tested Vercel deployment. A website rollback does not undo new Supabase bookings: reconcile orders before reopening Wix. Never restore an old database over new purchases without a deliberate reconciliation plan.
- Super Admins should check dashboard warnings after launch, monitor Vercel errors and review payment/membership/email reconciliation daily during the initial period.

No zero-problem guarantee or full launch sign-off is made. The release addresses the verified engineering issues; payment integration, final source-data reconciliation, complete disaster recovery, live domains and real-device acceptance remain release gates.
