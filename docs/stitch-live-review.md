# Review a Stitch design with Jira and Confluence

The live importer now supports Google Stitch as an alternative to Figma. It reuses the connection in Feature Coordinator, not an external Codex connector or a copied API key.

## Use the app

1. Open http://localhost:8080/features.
2. Enter the Jira story and Confluence page URLs in **Review live sources**.
3. Select **Google Stitch** as the design source.
4. Select **Load Stitch projects**, choose the project, then choose one screen.
5. Select **Import live evidence**. All selected sources must succeed before a new private review is saved. The import also stores a screenshot of that selected screen.
6. Inspect the source links, capture times, the screenshot and its capture time, and the coverage notes. Select **Ask agent to review** to compare the saved evidence with the agent.

The cancellation example uses **Order Cancellation Experience Flow → Order details — eligible**. Choose that screen to compare the design's cancellation wording against the story. Other screens are outside that capture. Repeat the import to capture a later version; existing reviews and approvals are preserved.

Figma remains available in the design-source menu. **No design** explicitly creates a Jira/Confluence-only review. A missing design is never replaced with sample evidence.

## Connection and security

Add a custom integration pointing to `https://stitch.googleapis.com/mcp`, with the `X-Goog-Api-Key` header saved in the standard encrypted connection UI. Personal and workspace connections are both supported, subject to the signed-in caller's existing access. No credential values are action arguments or results. A CLI verification must use the same organization scope as a workspace connection; a personal-only test cannot see workspace tools.

The adapter verifies the actual server endpoint instead of trusting its display name. It exposes only `list_projects`, `list_screens`, `get_project` and `get_screen`. Project/screen lists return only IDs and titles; signed download links stay on the server.

Screen HTML downloads can require authentication even after the MCP read succeeds. The adapter reuses only the scoped `X-Goog-Api-Key`, only at the same `https://stitch.googleapis.com` origin. CDN downloads receive no connector headers. Redirects are disabled, destinations are validated through the framework SSRF guard, and HTML is bounded to 1 MiB before inert text extraction. No scripts or referenced assets are executed. Provider errors cause failure, never a saved login/error page or synthetic fallback.

Google currently returns some HTML downloads inside a JSON `dataString` envelope. The reader decodes that envelope before extracting text; it does not save escaped script/source payloads as business evidence. Both direct-HTML and JSON-envelope responses have regression coverage.

## Screenshot capture

The import stores one screenshot of the screen the user selected. Only that screen is downloaded; other screens are never fetched. Bytes are validated as PNG, JPEG or WebP (1 MB bound), written to configured private blob storage under `features/<featureId>/…`, and the source keeps only the opaque handle, capture time, title and coverage note. The image is fetched for the UI through the authenticated `/api/features/<id>/screenshot` route, which reuses the feature's existing viewer access check and sends `Cache-Control: private, no-store`. It is never served from a public or signed CDN URL.

`get-feature` attaches the image to agent tool results as `_agentImages` after the same access check, so an agent review receives the screenshot alongside the captured text. UI reads stay text-only. The local Codex CLI transport cannot display image content (Core writes a text prompt to stdin), so the local agent receives `screenshotNotice` and must report that visual inspection is unavailable; the production Agent-Native transport receives the image. A failed image capture, storage write or import prevents the review from being saved; a failed bulk or individual deletion removes image bytes before rows and reports failure instead of claiming success.

## Coverage and limits

- Captures one selected screen's exported static HTML text, its title and its import-time screenshot.
- Includes the capture time and provider update time when available. If no version is returned, the UI explicitly says so.
- The screenshot proves only what that image shows at capture time. It does not prove interactions, responsive behaviour, other screens, rendered visibility in the live product, or the design's state after import. The local Codex review transport cannot inspect images at all.
- Does not generate/edit Stitch designs, send Discord messages or publish source updates.

Official references: [Google Stitch SDK](https://github.com/google-labs-code/stitch-sdk), [Google's Stitch MCP walkthrough](https://codelabs.developers.google.com/design-to-code-with-antigravity-stitch).

## Implementation

`server/features/stitch.ts` owns endpoint checks, tool allowlisting, metadata projection and authenticated asset reads. `provider-result.ts` decodes bounded MCP JSON envelopes. `server/features/screenshots.ts` owns byte validation, private storage, scoped reads and cleanup. `get-stitch-designs` is the shared project/screen discovery action; `import-feature-sources` persists the review and cleans up a stored screenshot if the row insert fails. The design provider constants belong to `shared/features/types.ts`. The picker is separate from the import form in `app/features/coordinator/StitchDesignPicker.tsx`.

The feature aggregate stores the additional source kind plus screenshot metadata; no migration is needed. The Figma input contract remains compatible with earlier callers. The live UI selects the design source explicitly, shows the screenshot with its capture time, and offers owner-only per-review deletion alongside the existing bulk deletion paths.

## Verified on 4 November 2026

The app's workspace connection listed projects and all six cancellation screens. The project/screen picker successfully created a three-source review through the browser. The final corrected review is `/features/2cc29e44-0a99-4bcc-933e-c760a0397664`, captured at 18:57 Beirut time. It contains actual Jira, Confluence and readable Stitch screen text with links and capture timestamps. Earlier diagnostic imports remain in the local test database; use this corrected review for the demo.

An actual Codex review completed in 24 seconds. It identified the 24-hour versus 48-hour mismatch with source citations and separately identified the design's instant-refund promise as unsupported by the captured requirements. It reported static-text coverage limits, did not invent a PO reply, and did not approve, send or publish anything.

The browser check also reproduced an agent handoff selecting the earlier conversation. Review requests now explicitly open a new conversation; proposal follow-ups keep the current conversation. The final browser test verified the correct feature ID appeared in the submitted prompt and a fresh answer compared Stitch evidence. Screenshots: `docs/images/stitch-agent-review.png` and `stitch-live-review.png`.

Final validation: typecheck passed, Doctor reported no findings, and 59 focused tests passed across seven files. Tests cover endpoint spoofing, read-only tool allowlisting, mismatched screen IDs, unsafe asset hosts, bounded downloads, JSON envelopes, script removal and credential confinement to the Google API origin, alongside prior source/access/revision/runtime checks. No production build was run.

## Screenshot verification — 8 November 2026

Verified locally with the connected workspace Stitch MCP server, the existing Jira/Confluence sources and an S3-compatible private bucket:

- Imported **Order Cancellation Experience Flow → Order details — eligible** with Jira `KAN-3` and the Confluence page. The import stored a 652 KB, 2560×2048 PNG and the review page rendered it through `/api/features/<id>/screenshot` with the capture time; the frontend `get-feature` payload stayed text-only.
- The screenshot route answered `401` without a session, `404` for a review without a screenshot, and `404` after deletion. No public or signed storage URL was exposed.
- Deleting the review through the page removed the stored object (provider `DELETE`, then a `404` read) and the review row. A forced cleanup failure is covered by tests and leaves the review intact.
- The local Codex transport called `get-feature` and received `screenshotNotice` rather than an image (the CLI cannot display images). The production transport's `_agentImages` contract is covered by tests on the action result; no production model provider was called here, so end-to-end vision in a production deployment remains unverified.
- Remaining limits: app file storage must be configured before a Stitch import (it fails closed otherwise); the provider owns the opaque object key (`private-blobs/<uuid>`), so the review association is persisted in the source metadata and SQL, not in the storage path; only one selected screen is captured; the local agent cannot inspect the image.
