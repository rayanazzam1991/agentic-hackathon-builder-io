# Feature Coordinator acceptance checklist

All product items are pending unless a dated implementation report establishes otherwise. Framework startup does not establish any product capability.

## Foundation and shared actions

- [x] Official Agent-Native scaffold is installed and its local URL responds (November 3, 2026; see foundation-report.md).
- [x] Installed framework instructions, dependency versions, and architecture conventions have been inspected (November 3, 2026).
- [ ] Domain state persists and is shared by the UI and agent through validated actions.
- [ ] Selected feature/question context reaches the embedded agent.

## Evidence and questions

- [ ] A feature has explicit source links and PO/BE/FE/design/QA ownership.
- [ ] Confluence/Jira/Figma sources retain source version, retrieval time, and exact references.
- [ ] Explicit open questions are extracted without inventing business rules.
- [ ] Missing evidence, possible conflicts, and approved decisions remain distinguishable.
- [ ] A suspected conflict shows the actual supporting sources and uncertain interpretations.
- [ ] Human edits/corrections persist and later agent work respects them.

## Resolution loop

- [ ] A reviewed question can be sent to the configured Discord thread with tracked message/delivery IDs.
- [ ] Failed sends are visible and retry does not duplicate a successful send.
- [ ] Actual replies correlate to the originating question with author and timestamp.
- [ ] A reply creates a proposed resolution; it does not automatically approve business policy.
- [ ] Approval is attributed to an authorized responsible person.
- [ ] The user sees a targeted Confluence diff before publication.
- [ ] Publication checks the expected source version and preserves concurrent edits.
- [ ] Only affected owners receive a material approved update; routine refresh is quiet.
- [ ] Rescanning identical evidence does not create duplicate questions/messages/decisions.

## Models and delivery

- [ ] Jev and OpenAI calls use the selected available models and preserve actual results/failures.
- [ ] Imported evidence cannot override instructions or trigger unauthorized actions.
- [ ] Missing keys disable dependent model calls with an actionable state while the app remains usable.
- [ ] Fixtures, generated results, recorded replies, and live interactions are clearly identified.
- [ ] The full connected loop is verified in a test feature/channel, including failures and stale updates.
- [ ] A developer tries the workflow and observations/limitations are recorded.
- [ ] The public recording shows the real app and the submission receipt is confirmed.
