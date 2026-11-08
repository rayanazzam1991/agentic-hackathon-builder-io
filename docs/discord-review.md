# First-phase review workflow

Open a live feature, ask the local agent for a review, curate the questions, and send each approved question to Discord on its own. Nothing here listens for replies or approves a business answer.

## Steps

1. **Open a live feature** (`/features/<id>`). Its saved channel and responsibility-to-role mappings are reused; reconnecting is only needed to change the channel.
2. **Ask agent to review.** The local Codex runtime reads the captured sources with `get-feature` and saves candidate questions with `propose-feature-questions`, each with an origin, verbatim excerpts and an optional role (with `ownerReason`). The agent then shows them with `show-feature-questions`. Proposals are chat cards, not pool questions.
3. **Accept or reject in chat** (owner). Accepting adds a suggested question with ask approval pending and warns about similar existing questions. The agent cannot accept.
4. **Edit and choose a recipient.** The owner picks a mapped responsibility, or a verified person or existing role via the directory. Changing text, owner, recipient or quoted evidence revokes approval and drops an unsent draft.
5. **Approve asking** (owner). This only permits asking; it is never business-decision approval.
6. **Save a Discord draft, then review it.** The draft snapshots the exact message (mention, question, conflict and evidence from Confluence, Jira and Figma, reference footer), channel and recipient. Saving makes no Discord request.
7. **Confirm and send** (owner, per question). Send re-checks the channel, bot identity and bot permission, reserves with a revision compare-and-set, posts with `allowed_mentions` limited to the one recipient, then reads the message back.

## Guarantees

- Each question has its own delivery record; one send never touches another.
- A sent question is frozen. Re-sending, re-drafting, editing and re-approving it are refused, and a repeated send request is a no-op that makes no Discord request.
- A repeat review only adds new findings. Approved, sent, dismissed and primary questions are never overwritten; duplicates are skipped with an explanation.
- A timeout or mismatched readback leaves delivery uncertain. Reconcile by reading the channel; never retry blindly.
- Mapping changes never retarget a reviewed or sent message.

## Not implemented

- No Gateway listener or automatic reply capture; replies are read on demand and are only displayed.
- No answer approval from Discord. A business decision needs the owner's reply entry, proposal and approval in the app.
- No automatic source refresh; sources are one-time captures.

## Verification

`server/features/first-phase-workflow.test.ts` runs the whole path over a mocked database and Discord API. Browser checks use a throwaway database and stop at the confirmation dialog; they must never press **Send question**.
