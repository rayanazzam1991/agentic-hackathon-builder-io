# MVP brief

## Promise and primary user

**Return from PTO, understand what changed around your story, and resume your unfinished work.**

The primary user is a developer who worked on one story within a large feature, handed it to another developer, and returned after one week away. Their contribution history does not make them the feature’s exclusive owner.

Today they must reread Jira, reconstruct old acceptance criteria, compare Figma versions, review feature-channel discussions, and ask the handover developer about missing context. The app assembles an editable, evidence-backed return brief focused on changes that affect their story. Broader demand and time savings remain unvalidated.

## First useful outcome

For one story and explicit handover/return checkpoints, the developer can inspect requirement and design changes, understand documented reasons, review relevant discussion, correct an explanation, prepare a focused follow-up, incorporate an attributed reply, and export a resume-work handoff. Missing sources, uncertain relevance, conflicting decisions, and unanswered questions remain visible. “Everything changed” is a user need, not a completeness guarantee over unavailable history.

## Bounded input

The first workflow accepts a prepared comparison package containing:

- Project, feature, story identity, story scope, handover developer, and explicit checkpoint dates/IDs.
- A handover note identifying completed work, unfinished work, and known questions.
- Jira story snapshots at handover and return, including description and acceptance criteria, source IDs, and snapshot versions/times.
- Figma before/after frame images plus identified frame/node excerpts or annotations, version identifiers, and links where available. Text-only evidence supports text comparisons, not claims of visual inspection.
- A bounded feature-channel discussion export with message/thread IDs, authors, timestamps, and story references where available.
- Optional code diffs and before/after excerpts with explicit revisions and stable line references to establish implementation behavior.
- Optional recorded follow-up replies with attribution and conversation references, introduced after the initial brief.

Step 2 defines and validates the concrete format and size limits, including image limits. The selected baseline is explicit; automatic contribution tracking, complete channel discovery, private Codex history, and live integrations are not prerequisites. Missing Jira or Figma baseline data is reported as a coverage gap rather than reconstructed from guesses.

## Core workflow

1. Select the feature/story and inspect the handover checkpoint, return checkpoint, and unfinished work.
2. Import the evidence package and inspect source coverage, versions, and missing inputs.
3. Generate a return brief comparing Jira requirements and Figma designs and extracting relevant channel decisions.
4. Inspect each change’s sources, documented reason, and effect on the unfinished story; label uncertain relevance and contradictions.
5. Review unresolved questions and draft a focused DM to the handover developer, including relevant source context.
6. Import a recorded reply or add an attributed clarification; keep unanswered questions open and refresh affected claims.
7. Correct, confirm, or dismiss claims, save review, and generate/export the resume-work handoff using those saved records.

## Brief and evidence contract

Each claim has an identifier, statement, category, source references, relationship to the selected story, and an epistemic label: supported, inferred, or unknown. Review state is separate: unreviewed, confirmed, corrected, or dismissed. These are conceptual values; implementation must define domain constants in the owning type file.

Categories cover requirement changes, design changes, observed implementation behavior, business intent, possible impact, and suggested next actions/checks. Separate what Jira requests, Figma depicts, code implements, and a person asserts. A design cannot prove server authorization; code cannot by itself establish business motive. Test suggestions are proposals, not executed results.

A source reference resolves to an imported artifact and exact excerpt, line range, message, or identified image/frame region. Explain why included discussion affects the story. Unrelated feature chatter must not become an action item; uncertain relevance is labeled. Missing rationale produces an open question. Conflicting Jira, Figma, discussion, or implementation evidence is surfaced with dates and sources; recency alone does not establish approval or resolution.

Follow-up records link each question to its recipient, originating claims, draft, and replies. Drafted, unanswered, and answered states must remain distinguishable. An imported reply does not imply the app delivered a DM. A developer’s explanation remains an attributed assertion unless corroborated by documentary evidence; disagreement remains visible.

Human edits preserve the original agent claim, attribution, and edit history. Confirmation does not upgrade evidence strength. Regeneration preserves reviewed corrections and flags conflicts. Follow-up replies become versioned evidence and refresh affected claims without discarding review history.

Every brief records story/checkpoint IDs, available source versions, and evidence version. New evidence makes the previous brief stale. Stale briefs remain viewable; a current handoff requires refresh and review of carried-forward corrections. Imported evidence cannot reveal later unseen changes in originating systems.

## Main workspace and shared actions

Use one workspace with a story/checkpoint selector, handover summary, Jira and Figma comparisons, relevant discussion, source viewer, open questions/follow-up panel, and contextual agent assistance. The selected story, change, and question provide agent context. UI and agent operations share persisted records.

Candidate shared actions are import comparison, generate brief, revise claim, draft follow-up, import reply, record clarification, save review, and export handoff. Exact APIs and framework integration belong to Step 3.

## Scope boundaries

Include one project and story at a time, imported Jira/Figma/channel evidence, actual agent generation, source inspection, human review, follow-up drafting and recorded-reply import, persistence, and Markdown export. The public demo uses invented, labeled snapshots and replies.

Defer live Jira/Figma/channel synchronization and DM delivery until the core workflow passes acceptance. A later messaging integration must use the selected recipient and actual delivery/reply states; this plan does not authorize messages to real colleagues. Also defer automatic code repair, command execution, organization-wide dependency graphs, notifications, multi-user collaboration, and automatic contribution tracking.

Build a focused application in this folder. Existing Forvexa governance work is background research; no code reuse or migration is assumed.

## Success and risks

Success means a developer can identify relevant business/design changes, distinguish decisions from unknowns, and resume unfinished work using a correct, actionable handoff. Measure task completion, source accuracy, unsupported claims, relevance errors, factual corrections, and observed catch-up time. A small trial cannot establish a general productivity claim.

The highest risks are invented business reasons, missing or mismatched baselines, irrelevant discussion presented as a requirement, conflating designs with implementation, and losing corrections when replies arrive. The evidence experiment tests these before substantial UI work.
