# Try the first feature review

This milestone is a saved review workflow using synthetic source snapshots. It does not connect to your company's Jira, Confluence, Figma or Discord yet. Local Codex can read the feature and propose a policy through shared actions; a person approves it in the review screen.

## Start

From the project folder:

```sh
cd feature-coordinator
pnpm dev:local
```

Keep that terminal running. Open http://127.0.0.1:8080/features (or the port printed by the terminal), then **Continue as local dev** if prompted. The first load after dependency optimization can be slow; subsequent page actions should acknowledge immediately. The server is already running when this milestone is delivered.

The desktop-bundled Codex CLI is selected on this Mac. If local chat reports an authentication failure, run its `codex login status` and sign in through `codex login`; do not paste tokens or API keys into the feature screen.

## Five-minute walkthrough

1. Click **Start sample review**. The app creates a private saved feature and opens its detail page. You should see **Needs an answer · Revision 1**.
2. Read **Source evidence**: the Confluence baseline and Jira say 24 hours; the Figma example says 48 hours. These excerpts are sample data. The question is already identified for this walkthrough, not discovered from a live design change.
3. The **Question owner** defaults to Product owner. You can choose another role and click **Save owner** while the question is open. Expand **Question to send** to inspect the draft. It explicitly says **Draft only · not sent**.
4. In **Reply text**, enter the sample response:

   > Use 48 hours for all new orders. The 24-hour rule is outdated.

   Keep **Reply from** as Product owner, then click **Save reply**. The state should become **Ready for a proposal**. It must not become Approved.
5. Click **Ask agent to propose**. The right panel opens and local Codex reads the saved feature, then uses the same update action as the UI to save a proposed cancellation paragraph and rationale. The page should refresh the saved proposal without a manual reload. The state should become **Awaiting approval**.
6. Alternatively, fill **Cancellation policy** and **Reason and evidence** yourself, then click **Save proposal**. Suggested manual policy:

   > Customers may cancel new orders within 48 hours of placing them. After that, cancellation is unavailable.

   Suggested rationale:

   > The recorded product-owner reply chooses 48 hours for new orders. This matches the Figma example and supersedes the 24-hour sample baseline and acceptance criteria.
7. Read the saved policy and **Specification update preview**. Click **Review decision**, inspect the exact saved proposal in the dialog, then click **Approve decision**. This records the current signed-in owner as approver. The state becomes **Approved**.
8. Inspect **Activity** and the before/after paragraph. It still says **Preview only · not published to Confluence**. Reload the page: the reply, decision, approver and activity must remain.

Use **All features** to return to the list. Start a fresh sample to try again. An approved review is locked in this first slice; later rule changes will need a new review cycle. No destructive reset is required.

## Useful checks

- **Correct a reply before approval:** record a corrected reply on a proposed decision. Its old proposal must disappear and the state returns to Ready for a proposal.
- **Two tabs:** open the same review in two tabs. Save from one, then save an old revision from the other. The server must refuse the stale edit and refresh the current record instead of overwriting it. Read the latest state and retry deliberately.
- **Stop local Codex:** click Stop response while it is running. Wait for it to stop, then retry. If it already saved a proposal before stopping, inspect the feature before asking it to repeat the write.
- **Sharing:** features are private by default. Use Share for explicit access. An editor can record replies/proposals; only the feature owner can approve. Public sharing is disabled. Sample owner roles such as Product owner do not grant real account permissions.
- **Agent approval boundary:** asking Codex to approve must direct you to the review UI. Its local allowlist contains no approval, publication or messaging action.

## Code and checks

- `shared/features/types.ts`: named wire constants, domain types and Zod contracts.
- `server/db/` and `server/plugins/db.ts`: framework SQL/sharing registration and additive named migration.
- `server/features/`: lifecycle, scoped store, write receipts and bounded local-agent protocol.
- `actions/*feature*.ts`: the UI/agent action contract; no duplicate CRUD API.
- `app/features/coordinator/`: focused components for evidence, question review, preview and workspace.
- `.agents/skills/feature-coordination/SKILL.md`: agent operating instructions.

Run from `feature-coordinator/`:

```sh
pnpm typecheck
pnpm agent-native:doctor
pnpm exec vitest run server/features/store.test.ts server/features/agent-protocol.test.ts server/lib/local-codex/local-codex.test.ts app/lib/chat-paths.test.ts
```

The targeted tests cover authentication/access refusal, stale edits and lost races, reply-versus-approval semantics, invalidation of an old proposal, terminal approved state, and rejecting approval/shell commands in the local action protocol. Real browser checks verify the visible flow and persistence; mocked store tests do not replace that check.

## Next milestone

Connect one selected Confluence page and one Jira story for real read-only snapshots, preserving source versions. Then add a configured Discord question/reply loop. Keep approval, publication version checks and delivery correlation explicit. GitHub remains deferred.
