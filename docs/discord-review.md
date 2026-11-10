# First-phase review workflow

Open a live feature, ask the local agent for a review, curate the questions, and send each approved question to Discord on its own. Nothing here listens for replies or approves a business answer.

## Steps

1. **Open a live feature** (`/features/<id>`). Its saved channel and responsibility-to-role mappings are reused; reconnecting is only needed to change the channel.
2. **Ask agent to review.** The local Codex runtime reads the captured sources with `get-feature` and saves candidate questions with `propose-feature-questions`, each with an origin, verbatim excerpts and an optional role (with `ownerReason`). The agent then shows them with `show-feature-questions`. Proposals are chat cards, not pool questions.
3. **Accept or reject in chat** (owner). Accepting adds a suggested question with ask approval pending and warns about similar existing questions. The agent cannot accept.
4. **Edit and choose a recipient.** The owner picks a mapped responsibility, or a verified person or existing role via the directory. Changing text, owner, recipient or quoted evidence revokes approval and drops an unsent draft.
5. **Approve asking** (owner). This only permits asking; it is never business-decision approval.
6. **Save a Discord draft, then review it.** The draft snapshots the exact message (mention, question, conflict and evidence from Confluence, Jira and Figma, reference footer), channel and recipient. Saving makes no Discord request.
7. **Confirm and send** (owner, per question). Send re-checks the channel, bot identity and bot permission, reserves with a revision compare-and-set, posts with `allowed_mentions` limited to the one recipient, then reads the message back. The same dialog offers one optional automatic follow-up (1–3 hours), showing the exact follow-up text, recipient and channel. It is scheduled only after the send is confirmed and can be cancelled while pending. See `docs/discord-followups.md`.

## Guarantees

- Each question has its own delivery record; one send never touches another.
- A sent question is frozen. Re-sending, re-drafting, editing and re-approving it are refused, and a repeated send request is a no-op that makes no Discord request.
- A repeat review only adds new findings. Approved, sent, dismissed and primary questions are never overwritten; duplicates are skipped with an explanation.
- A timeout or mismatched readback leaves delivery uncertain. Reconcile by reading the channel; never retry blindly.
- Mapping changes never retarget a reviewed or sent message.
- A follow-up is opt-in, sent at most once, and skipped when a qualifying reply exists. The worker claims with a revision compare-and-set and reconciles uncertain outcomes instead of reposting.

## Not implemented

- No Gateway listener; the open feature page refreshes recent replies and also offers an explicit refresh. Direct replies to the original question or its recorded follow-up are displayed. The latest 100 channel messages are scanned; up to 100 previously captured replies per question are retained as snapshots. Recording a primary answer rechecks the message in Discord.
- No answer approval from Discord. A business decision needs the owner's reply entry, proposal and approval in the app.
- No automatic source refresh; sources are one-time captures.
- No follow-up after the one scheduled reminder, and no Gateway listener for replies. Reply coverage is the latest 500 messages; incomplete coverage stays `unverified` and sends nothing.

## Verification

`server/features/first-phase-workflow.test.ts` runs the whole path over a mocked database and Discord API. `server/features/discord-followups.test.ts` covers the follow-up clock, replies, cancellation, restart, concurrency, permissions, coverage and uncertain delivery with a fake clock and mocked Discord. Browser checks use a throwaway database and stop at the confirmation dialog; they must never press **Send question**.
