# MVP acceptance checklist

All items are pending. This checklist defines the finished application; it is not a report of executed tests.

## Inputs and comparison

- [ ] A developer can select one project, feature, story, and explicit handover/return checkpoints.
- [ ] The handover note identifies the covering developer, completed work, and unfinished work.
- [ ] Jira description and acceptance-criteria snapshots can be compared with exact source references.
- [ ] Figma before/after images and identified frames/nodes can be inspected; unavailable visual evidence is disclosed.
- [ ] Feature-channel evidence retains message/thread identity, authors, timestamps, and story references.
- [ ] Missing baseline snapshots remain coverage gaps rather than reconstructed history.
- [ ] The app lists included sources and identifies omitted or unsupported input.
- [ ] Malformed packages, unresolved source IDs, and inputs over documented limits produce actionable errors.
- [ ] Reimporting the same package does not silently duplicate the comparison.
- [ ] The UI states that imported evidence cannot reveal later, unimported repository changes.

## Agent explanation

- [ ] Generation uses the supplied evidence and returns structured behavior changes, reasons, possible effects, questions, and suggested checks.
- [ ] Supported factual claims have resolvable references that support the actual claim.
- [ ] A technical refactor is not automatically described as a business change.
- [ ] The brief explains which requirement/design changes affect the unfinished story and labels uncertain relevance.
- [ ] Unrelated channel chatter is excluded from story actions; relevant decisions retain their references.
- [ ] Jira requirements, Figma designs, code behavior, and developer assertions remain distinguishable; designs do not prove server enforcement.
- [ ] Source recency alone does not resolve disagreement or establish an approved requirement.
- [ ] Missing business rationale remains unknown; inferred impact remains visibly inferred.
- [ ] Conflicting evidence is surfaced rather than silently reconciled into a confident story.
- [ ] Failed generation leaves saved briefs intact and supports retry.
- [ ] Imported text is treated as evidence, never as instructions to execute commands or change app behavior.

## Follow-up and clarification

- [ ] A missing reason can produce a focused DM draft for the selected handover developer, linked to the originating question and evidence.
- [ ] Drafting a question leaves it unanswered; no delivery or reply is implied by a draft.
- [ ] A recorded reply can be imported with author, timestamp, and conversation reference; the UI identifies it as imported example evidence in the demo.
- [ ] A developer assertion remains attributed, and absent corroborating tickets or decisions remain explicit.
- [ ] A reply refreshes affected claims without losing saved human corrections or concealing disagreement.
- [ ] Unanswered questions remain visible in the brief and export.

Live delivery is deferred. If added later, verify the selected recipient, actual delivery/failure result, and actual reply state separately; recorded fixtures never count as a live messaging test.

## Human review and shared state

- [ ] Selecting a claim opens its exact source excerpt without losing the current review.
- [ ] A developer can correct, confirm, or dismiss a claim and add an attributed clarification.
- [ ] Source support and human review state remain distinct.
- [ ] Refreshing retains saved briefs, edits, source references, and review history.
- [ ] Subsequent agent work uses saved corrections; regeneration preserves them and flags conflicts.
- [ ] The UI and agent invoke the same validated action implementations over the same records.
- [ ] Changing the comparison/evidence marks the previous brief stale; a current handoff requires refresh and review of carried-forward corrections.

## Useful handoff

- [ ] Markdown export includes story/checkpoint identity, completed/unfinished work, changed Jira criteria and Figma flow, relevant decisions, reviewed claims, reasons, citations, unresolved questions, and proposed next actions/checks.
- [ ] Dismissed claims are excluded from active conclusions; unreviewed or inferred claims retain their labels.
- [ ] Human clarifications and recorded developer replies remain attributed in the export.
- [ ] Proposed checks are never reported as executed or passed.
- [ ] Exported references remain understandable outside the app through source titles/IDs and excerpts or original links where available.

## Delivery evidence

- [ ] The four-case evidence experiment and both regression cases pass their recorded build gate.
- [ ] The main workflow is exercised in a real browser, including Jira/Figma source inspection, relevance review, a follow-up draft, recorded-reply import, correction, refresh, and export.
- [ ] Meaningful checks cover source-reference validation, correction persistence, staleness, and generation failure.
- [ ] A second feature is evaluated without changing expected answers to fit the generated result.
- [ ] At least one developer attempts the workflow; observations and limitations are recorded.
- [ ] The public demo uses clearly labeled example data and shows the actual application; imported snapshots and recorded replies are clearly distinguished from live integrations.
- [ ] Reused work is disclosed, the public Clips link is accessible, and submission receipt is confirmed.
