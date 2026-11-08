# Review a Stitch design with Jira and Confluence

The live importer now supports Google Stitch as an alternative to Figma. It reuses the connection in Feature Coordinator, not an external Codex connector or a copied API key.

## Use the app

1. Open http://localhost:8080/features.
2. Enter the Jira story and Confluence page URLs in **Review live sources**.
3. Select **Google Stitch** as the design source.
4. Select **Load Stitch projects**, choose the project, then choose one screen.
5. Select **Import live evidence**. All selected sources must succeed before a new private review is saved.
6. Inspect the source links, capture times and coverage notes. Select **Ask agent to review** to compare the saved evidence with local Codex.

The cancellation example uses **Order Cancellation Experience Flow → Order details — eligible**. Choose that screen to compare the design's cancellation wording against the story. Other screens are outside that capture. Repeat the import to capture a later version; existing reviews and approvals are preserved.

Figma remains available in the design-source menu. **No design** explicitly creates a Jira/Confluence-only review. A missing design is never replaced with sample evidence.

## Connection and security

Add a custom integration pointing to `https://stitch.googleapis.com/mcp`, with the `X-Goog-Api-Key` header saved in the standard encrypted connection UI. Personal and workspace connections are both supported, subject to the signed-in caller's existing access. No credential values are action arguments or results. A CLI verification must use the same organization scope as a workspace connection; a personal-only test cannot see workspace tools.

The adapter verifies the actual server endpoint instead of trusting its display name. It exposes only `list_projects`, `list_screens`, `get_project` and `get_screen`. Project/screen lists return only IDs and titles; signed download links stay on the server.

Screen HTML downloads can require authentication even after the MCP read succeeds. The adapter reuses only the scoped `X-Goog-Api-Key`, only at the same `https://stitch.googleapis.com` origin. CDN downloads receive no connector headers. Redirects are disabled, destinations are validated through the framework SSRF guard, and HTML is bounded to 1 MiB before inert text extraction. No scripts or referenced assets are executed. Provider errors cause failure, never a saved login/error page or synthetic fallback.

Google currently returns some HTML downloads inside a JSON `dataString` envelope. The reader decodes that envelope before extracting text; it does not save escaped script/source payloads as business evidence. Both direct-HTML and JSON-envelope responses have regression coverage.

## Coverage and limits

- Captures one selected screen's exported static HTML text and title.
- Includes the capture time and provider update time when available. If no version is returned, the UI explicitly says so.
- Does not verify rendered visibility, images, responsive behaviour, interactions, other screens or continuous change monitoring.
- Does not generate/edit Stitch designs, send Discord messages or publish source updates.

Official references: [Google Stitch SDK](https://github.com/google-labs-code/stitch-sdk), [Google's Stitch MCP walkthrough](https://codelabs.developers.google.com/design-to-code-with-antigravity-stitch).

## Implementation

`server/features/stitch.ts` owns endpoint checks, tool allowlisting, metadata projection and authenticated asset reads. `provider-result.ts` decodes bounded MCP JSON envelopes. `get-stitch-designs` is the shared project/screen discovery action; `import-feature-sources` persists the review. The design provider constants belong to `shared/features/types.ts`. The picker is separate from the import form in `app/features/coordinator/StitchDesignPicker.tsx`.

No dependency or database migration is needed; the existing versioned feature aggregate stores the additional source kind. The Figma input contract remains compatible with earlier callers. The live UI now selects the design source explicitly.

## Verified on 4 November 2026

The app's workspace connection listed projects and all six cancellation screens. The project/screen picker successfully created a three-source review through the browser. The final corrected review is `/features/2cc29e44-0a99-4bcc-933e-c760a0397664`, captured at 18:57 Beirut time. It contains actual Jira, Confluence and readable Stitch screen text with links and capture timestamps. Earlier diagnostic imports remain in the local test database; use this corrected review for the demo.

An actual Codex review completed in 24 seconds. It identified the 24-hour versus 48-hour mismatch with source citations and separately identified the design's instant-refund promise as unsupported by the captured requirements. It reported static-text coverage limits, did not invent a PO reply, and did not approve, send or publish anything.

The browser check also reproduced an agent handoff selecting the earlier conversation. Review requests now explicitly open a new conversation; proposal follow-ups keep the current conversation. The final browser test verified the correct feature ID appeared in the submitted prompt and a fresh answer compared Stitch evidence. Screenshots: `docs/images/stitch-agent-review.png` and `stitch-live-review.png`.

Final validation: typecheck passed, Doctor reported no findings, and 59 focused tests passed across seven files. Tests cover endpoint spoofing, read-only tool allowlisting, mismatched screen IDs, unsafe asset hosts, bounded downloads, JSON envelopes, script removal and credential confinement to the Google API origin, alongside prior source/access/revision/runtime checks. No production build was run.
