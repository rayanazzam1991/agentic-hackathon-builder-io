# Feature Coordinator: MVP brief

Pivot selected November 3, 2026. This replaces Feature Memory as the competition entry. The [previous brief](archive/feature-memory/mvp-brief.md) and [unrun experiment](../experiment/README.md) are retained as historical work; that experiment is not a prerequisite to starting this application.

## Product promise

Keep one feature’s business requirements, API contract, and design aligned by turning open questions and possible inconsistencies into tracked, owned decisions.

The starting user is a developer in the user’s company. The PO writes a Jira story, teams create role-specific tasks, the backend developer maintains a Confluence feature specification, and Figma designs may arrive after implementation starts. Business rules are incomplete and people manually reconcile differences. The agent should reduce delay before asking questions and make unresolved decisions visible. It cannot guarantee that people respond faster or that a feature is complete.

## First complete workflow

1. Register one feature with its Confluence page, Jira story IDs, selected Figma frames, feature Discord channel, and named PO/BE/FE/design/QA owners.
2. Read versioned evidence and list explicit open questions first. Identify possible disagreements with exact source excerpts or design-frame references; distinguish missing evidence from contradiction.
3. Assign each question to an identified decision owner, showing why it affects the feature and which work is blocked.
4. Draft and send the focused question in a configured Discord feature thread; save delivery status and message/thread IDs. Failed delivery stays retryable and cannot become asked or answered.
5. Correlate actual replies with the question. Record the author, evidence, suggested resolution, and remaining ambiguity.
6. The responsible person confirms the decision in the app. A reply is evidence, not automatic approval; the agent cannot approve its own business interpretation.
7. Propose a targeted Confluence update, show a diff, and publish the explicitly approved change against the expected page version. Preserve history and surface concurrent edits instead of overwriting them.
8. Notify the affected roles with the approved outcome and source links. Recheck linked sources on demand; later monitoring invokes the same actions and avoids duplicate questions/notifications.

## Authority and evidence

Confluence is the team’s agreed feature specification, not proof that every sentence is approved. Distinguish proposals, unanswered questions, and accepted decisions. PO owns business rules; design, BE, FE, and QA owners confirm their respective decisions. The app records the configured responsible reviewer and actual approval identity.

Figma expresses design intent, Jira records requirements/tasks, and a backend contract describes an interface; none alone proves deployed implementation. A new version is not automatically authoritative. Uncertainty and cross-source disagreement remain inspectable. Confirmation does not strengthen source evidence. Imported text is evidence, never executable agent instructions.

## First workspace

One feature workspace: linked sources and freshness, open questions, possible inconsistencies, owners, replies, proposed updates, and a decision timeline. Selecting a feature/question supplies context to the embedded agent. Human edits and agent actions update the same persisted records.

## Models and shared actions

Retain the selected Jev + OpenAI nano approach. Jev makes typed relevance/support decisions; OpenAI `gpt-5-nano` is the documented interpretation of the requested nano model and drafts readable questions/explanations. Verify model availability before calls and do not substitute silently. Credentials are server-side and are not needed to scaffold the app.

Proposed actions: registerFeature, refreshSources, listQuestions, reviewQuestion, draftQuestion, sendQuestion, ingestReply, proposeDecision, approveDecision, proposeSpecUpdate, publishSpecUpdate, and notifyAffectedOwners. Exact exports follow the installed framework’s conventions. Define capabilities once with validated inputs, authorization, and persisted state; UI, agent, and later event jobs use the same implementation.

## Scope

Initial product target: one feature, one Confluence page, linked Jira stories, selected Figma frames, and one Discord feature thread. Start with manual refresh, explicit open-question extraction, and a small set of evidence-backed conflict checks. Discord channel/thread messaging precedes private DMs. Live integrations are part of the product target and are built incrementally; adapters and fixture inputs must be visibly distinguished.

Defer organization-wide crawling, automatic FE/BE task decomposition, estimation, GitHub/code analysis, autonomous business approval, broad document rewriting, and continuous monitoring until the first loop works. GitHub can later supply implementation evidence; Feature Memory can later summarize this decision history.

## Delivery order and current authorization

1. Foundation: scaffold the official Agent-Native standalone Chat template locally, inspect its bundled instructions, install dependencies, start it, and verify the local URL. Write the current brief and technical delivery plan. No provider key is required for this step.
2. First domain slice: persist one feature, versioned sources, owned question, recorded reply, proposed decision, human approval, and proposed specification update through shared actions/UI. Use labeled fixtures only until actual adapters exist; no fake live agent results.
3. Connect Confluence and Jira reading plus model-backed question extraction; evaluate actual results in the app.
4. Connect the Discord send/reply loop and Confluence approved update publication in a test feature/channel. Configure exact destinations before sends.
5. Add Figma comparison and targeted notifications, then reliability checks, developer trial, and recording.

These are separately reviewable steps. Foundation authorization does not imply external messages or publication to company systems. Ask about committing completed steps without committing automatically; commit approval does not authorize the following step.
