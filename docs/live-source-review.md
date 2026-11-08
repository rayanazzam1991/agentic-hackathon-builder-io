# Review real source evidence

Google Stitch is now available as an alternative design source. Use the [Stitch walkthrough](stitch-live-review.md) for the current picker, successful three-source verification and corrected demo review. The Figma-specific steps and rate-limit report below describe the earlier integration milestone.

Open the Feature Coordinator app at http://localhost:8080/features. Use **Review live sources**, separate from **Start sample review**.

1. Connect your personal Atlassian account in Settings → Integrations. This is the app's connection, independent of the connector in Codex chat. The initial reader supports exactly one visible Atlassian connection; it fails rather than picking an arbitrary account when several match.
2. Save a Figma access token through Settings → API keys, or use the shared Figma connection. The token account needs file access and `file_content:read`. No editing permission is required for the REST reader.
3. Paste the Jira story URL, Confluence published-page/tiny URL, and Figma Design URL including `node-id`. Jira and Confluence must be on the same Cloud site.
4. Leave **Include Figma evidence** checked for a three-source review. If Figma is rate limited, explicitly uncheck it for a Jira/Confluence-only review; the result prominently says the design was not verified. The Figma locator remains in the form so it can be used for a later import.
5. Select **Import live evidence**. All selected reads must succeed before a new private review is saved. No source document is changed. Provider versions, capture times, links and scope notes appear beside the evidence.
6. Select **Ask agent to review**. Local Codex reads `get-feature` and compares the persisted evidence. It should cite actual supporting text and URLs, distinguish documented claims from independent evidence, and suggest the next question and owner. It must not invent a PO reply.

Repeat the import for fresh evidence. Existing reviews are snapshots, not continuously synchronized documents. Approved history stays separate. Replies and approvals use the existing review controls; Discord delivery and source publication remain unimplemented.

## Coverage

- Jira: selected story description and summary, with update timestamp. No comments, linked tasks or separate acceptance-criteria custom fields.
- Confluence: published page text, title and version. A published page can itself say “Draft”; that editorial status is retained. No comments, attachments or rendered macros.
- Figma: visible editable text/layer names below the selected node, with returned file version. No image OCR, geometry-based visibility checks, comments or prototype interactions. Oversized/truncated responses fail rather than silently supplying partial evidence.

Confluence may already mention a Figma mismatch. That is not proof of the current design. A two-source review must say the Figma claim remains unverified.

## Verification on 4 November 2026

The app successfully imported the user's selected Jira story and published Confluence page through its own Atlassian connection. The browser showed actual provider text, source links, versions and capture times in a new live review. The previous sample remained separate.

The saved live review is `/features/2251efcd-4a0c-4fa5-87e6-17fbea0e42be`. Reloading preserved its source evidence and open state. Local Codex completed an actual `get-feature` review in the sidebar: it cited the 24-hour baseline, identified the documented Figma discrepancy as unverified, suggested the PO cancellation-window/scope question and listed backend/design dependencies and coverage limits. It did not record a reply or change the feature revision. Screenshots are in `docs/images/live-source-review.png` and `live-source-agent-review.png`.

Figma returned HTTP 429. The three-source import failed without saving a review; explicitly excluding Figma then created the two-source review. Do not describe Figma as live-verified. Follow the displayed retry-after period or plan limits before retrying; changing the API token does not necessarily change the quota.

The provider runtime handles scoped credentials, authentication, response-size limits and safe HTTP requests. The app sends no credentials to Codex and logs no source payloads. Reimport creates a new resource so source changes cannot silently retain a previous decision's approval.

## Checks

From `feature-coordinator`, run:

```sh
pnpm typecheck
pnpm agent-native:doctor
pnpm exec vitest run server/features/live-sources.test.ts server/features/source-input.test.ts server/features/store.test.ts server/features/agent-protocol.test.ts server/lib/local-codex/local-codex.test.ts app/lib/chat-paths.test.ts
```

Tests cover unsafe/cross-tenant links, source normalization, hidden Figma nodes, bounded extraction, provider envelopes, error/truncation rejection, explicit Figma exclusion, rate limits, ambiguous accounts and the existing access/revision/approval/local-runtime checks. Provider fixture tests use invented data, not copied company records.

Final checks passed: typecheck, Doctor with no findings, and 40 tests across six files. The successful Figma response path is covered by fixtures; a real successful Figma read remains blocked by HTTP 429. No production build was run.
