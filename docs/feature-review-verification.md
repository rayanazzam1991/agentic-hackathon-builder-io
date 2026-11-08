# Feature review verification — November 3, 2026

## Delivered

The app now opens the feature workspace at `/features` (`/home` redirects there). One synthetic cancellation-policy conflict can be taken through a recorded reply, a saved proposal, owner approval and an unpublished paragraph preview. The same validated actions power the UI and local Codex's bounded application-action protocol. No company source or destination was accessed.

## Verified evidence

- Named additive migration `feature-coordination-review-cycle` applied successfully to local PGlite. Existing framework/chat data was preserved.
- Browser local developer sign-in landed on `/features`.
- Start sample review created feature `72b1a835-7d1c-40c3-b106-fd0da94622ef`, private to the local dev identity.
- The UI saved the sample Product owner reply and showed Ready for a proposal at revision 2, without approval.
- A real local Codex run called `get-feature`, then `update-feature-question` with the observed revision. The write receipt/readback confirmed a persisted proposal at revision 3. The page showed Awaiting approval and the proposed paragraph.
- The review dialog displayed the persisted proposal and rationale. Approve decision through the proven frontend saved Approved at revision 4 with `dev@local.test` and a timestamp. Activity retained sample creation, reply, proposal and approval. The source baseline stayed unchanged and the preview remained explicitly unpublished.
- Reload retained revision 4, reply, decision, approver and history.
- A 390 × 844 viewport showed usable mobile navigation, wrapped copy and stacked source panels. The temporary viewport override was reset.
- Cancellation in the integrated sidebar showed Stopped; a subsequent review turn started successfully. Overlap ownership, cancellation-slot retention, and stale-release handling are covered by targeted tests.

Screenshots: [approved review](images/feature-review-approved.png), [phone width](images/feature-review-mobile.png).

## Checks

- `pnpm typecheck`: exit 0.
- `pnpm agent-native:doctor`: exit 0, Clean — no findings.
- Targeted Vitest run: 4 files, 22 tests passed. Covers the original local trust boundary plus feature access/transition/CAS rules and local protocol rejection of approval, arbitrary tools and malformed output.
- No production build: the generated app instructions specify typecheck, Doctor and browser smoke for this milestone.

The initial browser test exposed that the custom runtime advertised model selection as unsupported. The bridge now accepts its one configured local model, validates it server-side, forwards reasoning effort, and returns aggregate run/turn IDs so the shared sidebar can show Stop/Queue controls. A second issue was model confusion between read-only source files and authorized domain-record changes. The protocol now distinguishes those boundaries explicitly; the successful proposal write above verified the correction. Handoff failures are acknowledged through the framework's confirmation API and shown in the feature screen instead of being silently dropped. A failed/uncertain write is never automatically retried by the UI.

## Current limits

This is a sample-driven review slice, not live monitoring. The known mismatch is seeded, replies are entered manually, and messages/publication are previews only. Approved decisions are locked; later source changes need a new review-cycle capability. The first proposal used for browser verification includes a human-approval reminder in its text; the agent instructions were subsequently clarified to keep workflow warnings and unresolved scope in the rationale, leaving policy text suitable for the paragraph preview. The original saved sample was retained as tested rather than rewriting its approved history.

Starter source-map, h3 route-rule and React script-tag warnings were still observed. Browser reconnection was occasionally slow after development hot reload; once loaded, sample mutations and the approval dialog completed visibly. No framework package was patched to suppress those messages.

The root and app still have no active Git repository. Prior foundation/runtime work and this milestone remain uncommitted; no commit or Git initialization was performed.
