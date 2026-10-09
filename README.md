# Dynamo Gymnastics — visual replica

Static presentation of the public dynamogymnastics.co.uk website captured on 9 October 2026. Existing Wix HTML and styling are retained to preserve the current appearance rather than redesign it. Images are downloaded into public/assets.

## Run

`npm run dev` serves the website on port 3000. `npm run build` creates dist/. The repository contains a Vercel configuration for a static deployment.

## Scope

Public page navigation and external information links are retained. Wix runtime scripts, embeds, analytics and application integrations are removed. Login, booking, payments and submissions are not implemented. Staff-only content and authenticated member pages are not copied. There is no CRM or member data in this repository.

The capture uses Wix's public desktop HTML; device-specific Wix mobile layouts and dynamic application widgets may require a separate visual pass. The original Wix site is unchanged. Fonts retain their existing Wix-hosted references.

`capture-manifest.json` lists captured pages. `scripts/capture.py` refreshes the public snapshot (requires Python requests and beautifulsoup4). This snapshot is a visual starting point; future features should be implemented as independent application code.

### Membership and event preview

The management preview now uses `public/manage/membership.js` for classification and booking eligibility. Run `npm test` to check the supplied classes, exact MA/WA tokens, Advanced precedence, staff parents, account grouping, inactive records and price eligibility.

- Matching is case insensitive. Within each comma/semicolon/newline-separated class entry, Advanced overrides Recreational; Development modifies the MA/WA squad in that entry. Distinct classes remain distinct, allowing gymnasts to have several groups. Staff markers are independent and aggregate across an owner's normalized email address.
- `Dev` is flagged for review rather than treated as Development. Unmapped entries do not grant membership. Trusted import rows require a stable gymnast ID and explicit active enrolment status; classification alone does not establish active membership. Staff-only rows do not create a gymnast.
- Events store GBP prices as integer pence, supporting equal prices and free events. Public events accept non-members. Member-only and selected-group events check the selected active gymnast, preventing a sibling's class from satisfying a restriction. Member pricing follows an account with at least one active gymnast. Development squads are individually selectable.
- Contacts and Test class rules use fictional examples. Event edits remain in browser session storage. Sync Members now opens a protected automatic-export connection test. No live membership imports, email OTP, staff authentication, checkout or persistent server storage is connected. These pure rules must also run on the server when those features are implemented; browser state is never an authorisation source.
- A future sync needs a validated full snapshot, stable IDs, an explicit active-enrolment contract and a review step for ambiguous/unmapped rows. Partial/failed exports must not deactivate members. Do not commit member exports or credentials to the repository.

### Browserless automatic-export connection test

`Sync Members` now opens a test dialog, backed by `POST /api/sync-members`. This is **not a membership import**. The worker uses the login selectors and Dynamo organisation navigation observed in Thrive4. The Browserless login and download succeeded in a live test on 9 October 2026; membership storage is a separate setup step.

In the existing Vercel project, add the following as **Production-only Secret environment variables**, then redeploy:

| Variable | Value |
| --- | --- |
| `BROWSERLESS_TOKEN` | Token from your free Browserless account |
| `THRIVE_EMAIL` | Thrive4 administrator login email |
| `THRIVE_PASSWORD` | Thrive4 administrator password |
| `SYNC_TEST_KEY` | Random, unique administrator test key, at least 32 characters |

Enter only `SYNC_TEST_KEY` into the test dialog. The website does not accept Thrive4 credentials. The test key is not stored in session/local storage; it is sent in a Bearer header over HTTPS and the input is cleared at submission. It is a temporary test-access mechanism, not the final staff authentication system. Rotate it after testing. Before enabling actual member updates, replace it with verified staff-session authorisation and add persistent job locking/rate limits, protected storage and validated export parsing.

The worker connects to the London Browserless endpoint. Browserless receives the login credentials and export inside its remote browser; check your account’s privacy/session logging settings before configuring real member data. The worker does not request session persistence, proxies, CAPTCHA solving, stealth or recordings. A fresh login runs for each test, with a 110-second total deadline and automatic browser cleanup. Extra verification or changed page controls fail the test rather than bypassing checks. The free plan’s two-minute browser-session limit is respected; quota and Vercel usage are still subject to the providers’ plans.

Only the filename extension and Excel container signature are identified at this stage; this does **not** validate workbook contents or active membership. Files are capped at 15 MB and kept only in server memory until discarded. The client receives only format, byte count, duration, hash and test outcome; no contact records, file contents, cookies or passwords. Existing membership data is never modified by this endpoint. No scheduled jobs or automatic retries are enabled.

Development: `npm test` checks authentication, failure sanitisation and export identification. `npm run dev` is a static server and cannot execute `/api`; test the deployed Vercel function or use `vercel dev`.

### Durable member sync (prepared; database setup required)

Live login/download was confirmed on 9 October: 305 KB XLSX in 22.2 seconds.
The menu now reads **Sync Members**. Actions include membership sync, export-column inspection and the existing download-only test. The temporary administrator key protects every action and contact response; do not treat the public management preview as staff authentication. No importer calls an email or Auth signup endpoint.

Provision a separate Dynamo database and apply `database/member-sync.sql`. Add Production secrets `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (new server-only sb_secret key; legacy `SUPABASE_SERVICE_ROLE_KEY` is also supported) and `THRIVE_EXPORT_MAPPING` in Vercel. The mapping must name the actual export headings for `id`, `email`, `firstName`, `lastName`, `timeClass`, optionally `ownerName`, `dateOfBirth`, `bgNumber`, and either `status` with `activeValues`, or a verified `membershipPolicy: "assigned_classes"` contract. Do not assume old class text proves a currently active enrolment. Use **Check export columns** to see headings and row count without exposing any contact rows. Never place service keys or member data in Git.

The SQL creates permanent account/profile IDs, separate purchase/transaction tables, an atomic roster function and sync audit counts. Importing updates only imported identity/profile details and membership/staff flags. It never deletes accounts/profiles, recreates Auth identities, changes purchases/transactions, or sends email. A member who leaves becomes non-member and retains their account/profile/history. The eventual OTP login must resolve to the permanent account ID for the verified email; OTP and checkout remain unimplemented.

Empty/invalid exports, duplicate or missing IDs, unknown classes, identity moves between owner emails, stale snapshots and a greater-than-25% drop in account/member/gymnast counts fail without applying a partial update. A full snapshot is still an export contract: the file format alone cannot prove completeness. Identical hashes return unchanged. The database transaction serializes commits; concurrent downloads may still consume Browserless quota. Staff authentication and durable job reservation before downloading remain necessary before general staff rollout.

Tables have RLS and no anonymous/authenticated access grants; the roster RPC is granted only to `service_role`. Contacts are returned only through a server endpoint authenticated by the administrator key, and are held in page memory, not the preview's session storage. Calendar/event/payment editing remains fictional preview data. The DynamoGymnastics project (ahtwwzcmqkvycrgurlwf, London) was provisioned on 9 October 2026. The schema was applied and verified with transaction-rolled-back fictional data: service-role execution, repeat-import idempotency, stable account/profile IDs, retained successful/declined transactions, former-member flags and partial-snapshot rollback all passed. The test left all tables empty. Live import still requires the Vercel service-role secret and verified export mapping; unit tests also use fictional Excel fixtures for grouping and history preservation.


### Confirmed Thrive4 export format

The inspected full Contacts export has 896 rows and seven headings: `last name`, `first name`, `time and class`, `account owner`, `owner email`, `*bg membership number`, `date of birth`. It contains no contact ID or active status. The configured contract uses recognised assigned classes as current enrolment and derives a profile key from canonical owner email, first/last name and DOB. Changes to class or BG number do not change profile identity. Missing/invalid DOB or duplicate identity blocks a gymnast import; staff-only/non-member rows do not require a child DOB. A changed name/DOB/owner matching a missing existing profile is held for review to avoid silently replacing its permanent ID. Historical profiles remain when membership ends. This derived identity cannot supply the same guarantees as a provider-issued immutable ID; deliberate identity corrections need an administrator reconciliation workflow.
