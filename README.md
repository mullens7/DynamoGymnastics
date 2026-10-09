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
- Contacts and Test class rules use fictional examples. Event edits remain in browser session storage. Sync Member remains inactive. No Thrive4 automation, real imports, email OTP, staff authentication, checkout or persistent server storage is connected. These pure rules must also run on the server when those features are implemented; browser state is never an authorisation source.
- A future sync needs a validated full snapshot, stable IDs, an explicit active-enrolment contract and a review step for ambiguous/unmapped rows. Partial/failed exports must not deactivate members. Do not commit member exports or credentials to the repository.
