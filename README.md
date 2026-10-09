# Dynamo Gymnastics — visual replica

Static presentation of the public dynamogymnastics.co.uk website captured on 9 October 2026. Existing Wix HTML and styling are retained to preserve the current appearance rather than redesign it. Images are downloaded into public/assets.

## Run

`npm run dev` serves the website on port 3000. `npm run build` creates dist/. The repository contains a Vercel configuration for a static deployment.

## Scope

Public page navigation and external information links are retained. Wix runtime scripts, embeds, analytics and application integrations are removed. Login, booking, payments and submissions are not implemented. Staff-only content and authenticated member pages are not copied. There is no CRM or member data in this repository.

The capture uses Wix's public desktop HTML; device-specific Wix mobile layouts and dynamic application widgets may require a separate visual pass. The original Wix site is unchanged. Fonts retain their existing Wix-hosted references.

`capture-manifest.json` lists captured pages. `scripts/capture.py` refreshes the public snapshot (requires Python requests and beautifulsoup4). This snapshot is a visual starting point; future features should be implemented as independent application code.
