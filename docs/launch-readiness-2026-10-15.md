# Dynamo release checks — 15/10/2026

Engineering verification is complete for this release, subject to the owner acceptance and cutover steps below. Wix/DNS have not been switched. No emails, notifications, payment charges or provider refunds were sent or attempted by this work.

## Verified

- 231 automated tests and the production build passed. Production dependency audit: zero known advisories after updating sharp to 0.35.5 and overriding ExcelJS's compatible UUID dependency to 11.1.1.
- 19 transactional database suites passed: 18 against Supabase with rollback, and the combined-source sync suite against an isolated restored PostgreSQL 17.5 database. SQL fixtures were updated to the current medical-field and party-destination contracts; no application checks were relaxed.
- Twelve hosted page routes returned 200. Live authenticated API checks passed for Super Admin, Event Admin, Check-in, Party Staff, Staff Planner, member and non-member fictional accounts. Restricted accounts could not read Contacts or award email settings. Seven temporary accounts/sessions were removed.
- Stripe read-only health: correct Dynamo connected account; card capability active; charges/payouts enabled; webhook enabled with checkout, failure and refund events. No payment or refund request was issued.
- OTP, event and award templates generated locally. A ticket image generated correctly, and all five hosted signature images returned image responses. No email was sent.
- 24 built HTML documents had no broken local asset/page references. Public browser checks confirmed the home/navigation, three event listings and six Fun Sessions rows with UK dates, ages and availability labels. This does not replace physical iPhone/Android acceptance.
- All 55 legacy event bookings remain. No negative wallets, temporary wallet-hold history entries, or payment/confirmation reviews were found in the checked window. Security advisor has informational notices for intentionally server-only RLS tables, with no warning/error findings. Runtime error/fatal query for the recent available window was empty; it is not a claim about unavailable historical logs.
- Current Wix web DNS and Google Workspace MX/TXT records were captured for rollback. Auth/manage DNS currently do not exist. No DNS or domain ownership settings were changed.

## Fixes in this release

- Management logout clears the shared final-domain cookie and revokes its server session.
- Award confirmation jobs now appear in Super Admin delivery warnings and are included in the five-minute status recovery sweep. Recovery changes interrupted attempts to review; it never sends mail.
- Audited dependency updates above, with workbook parsing, image generation and email/ticket tests rerun.

## Recovery copy

A private application-data recovery archive was saved separately from Git. It contains a consistent 40-table snapshot (2,123 records), live columns/defaults/constraints/indexes, 53 functions, 11 triggers, grants/schedules, five uploaded images (209,458 bytes) with checksums, and prelaunch DNS records.

The snapshot restored into a fresh isolated PostgreSQL 17.5 engine. All 2,123 rows matched exactly; 44 foreign keys, 52 checks, 40 primary keys, ten unique constraints and one exclusion constraint were present. Active user sessions and OTP challenge rows are intentionally excluded, as are secrets. No accounts currently link to Supabase Auth users. The supplied recovery SQL expects a fresh Supabase project's platform schemas; the isolated rehearsal supplied an empty auth.users reference table.

This verifies application schema/data and file copies. It is not a restore of the hosted Supabase platform, Vercel credentials, Vault secret values, scheduled HTTP dispatch, TLS or DNS. On a replacement Supabase project, restore/upload the files, rewrite old project storage URLs, provision the documented secrets/scheduler, and verify in isolation before switching traffic. Never overwrite post-snapshot purchases with an old snapshot.

## Owner actions before publication

1. Combined Dynamo/Gymtots sync is now verified: latest successful run 15/10/2026 14:31 UK, 1,135 accounts and 1,204 gymnasts. Review the final counts against both organisations before cutover.
2. Stop Wix bookings for the final transfer; provide/reconcile anything booked since the earlier import, including every existing party and blocked date. The new database currently has zero confirmed party bookings and only three future party slots.
3. Set award prices (all 17 enabled awards currently have no price) or keep award purchasing unadvertised until ready. Confirm actual party availability, event prices/capacities, ages and public wording. Do not invent pricing or dates.
4. On real phones, complete the short owner acceptance: OTP login, mixed household pricing, multiple-child basket, returning from Stripe, successful/failed/cancelled result, wallet total, restricted staff and session QR check-in. Any real email/payment/refund tests remain owner-controlled and separately authorised.
5. Authorise publication and connect main/www/auth/manage domains using Vercel's displayed DNS values. Preserve Google Workspace MX/TXT records. Verify final-host login/logout and HTTPS before reopening bookings. Refresh the recovery snapshot after final data import.

## Cutover and rollback

Keep Wix intact. Record the final export cutoff, booking counts, backup time and deployed commit. Switch only web DNS records. If a serious issue appears, stop new bookings and revert web DNS or the tested Vercel deployment. Reconcile any orders already accepted by the new system before reopening Wix; a website rollback does not reverse Supabase data or Stripe transactions.

## Final admin responsive review — 15/10/2026

- Fixed a conflicting 700px breakpoint: booking/history tables now switch fully to record cards through the shared 850px phone/tablet breakpoint, including dashboard tables and booking dialogs.
- Constrained long confirmation/action buttons to their available width; allowed header links and calendar action buttons to wrap cleanly; removed an event-row width/margin combination that could overflow on phones.
- Email confirmation settings now have full-width labelled fields and aligned checkbox controls. Dialog fieldsets can shrink, and each editor opens at the top rather than retaining the previous dialog's scroll position.
- Production build and all 231 automated tests pass; production dependency audit reports zero known vulnerabilities. These are code and regression checks, not proof of every device layout.
- Live browser navigation confirms public home/events render and use saved listings. Authenticated admin visual checks on physical iPhone/Android remain an owner acceptance gate: this browser has no staff session and no supported viewport-resize capability. No OTP/email was requested to acquire one.
- Latest read-only database checks: zero negative wallets, payment/refund reviews or confirmation reviews; 58 confirmed event bookings. Awards still have 17 missing prices; parties still have zero confirmed bookings and three future slots.
- Supabase security advisor has informational server-only RLS/no-policy notices; no warning/error findings. Vercel reports a Node DEP0169 URL parsing deprecation from the runtime/dependency path, with no separate application exception group in the checked result.
- The UK midnight/noon membership scheduler and payment/notification status recovery cron entries are active. No scheduled job was manually triggered during this review.

This release is a candidate for owner acceptance and cutover, not an unconditional guarantee. The earlier transactional database suites remain applicable; they were not rerun for CSS-only changes. No 250-user simultaneous load test has been completed. Confirm production hosting/database plans and limits, reconcile final Wix bookings, set missing prices, complete physical-device acceptance and refresh the recovery snapshot after final imports before changing DNS.
