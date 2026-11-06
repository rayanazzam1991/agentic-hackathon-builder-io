---
name: feature-coordination
description: Resolve a feature question from source evidence through a recorded reply, proposed business decision and human review.
scope: both
metadata:
  internal: true
---

# Feature coordination

Use the primary actions documented in AGENTS.md. The feature workspace is `/features`; a detail page is `/features/<id>`. Inspect current navigation or the feature ID supplied by the UI. Read the feature before any edit and use its returned revision. Never silently retry a stale edit: inspect the changed evidence first.

1. Check data.sample. True means synthetic fixtures. False means captured live provider evidence with URLs, versions, capture times and scope notes. Missing Figma means design contents are unverified; Confluence claims about Figma are not independent proof. No automatic monitoring exists.
2. Assign the open question to its responsible role. Live reviews expose a People and roles section that maps responsibilities to actual Discord server roles. Mapping a role does not grant app access or verify a person’s authority. A new saved draft snapshots the current question owner’s mapped recipient; changing a mapping does not retarget an existing draft. Only that explicit recipient may be notified, after frontend owner confirmation. No Gateway listener exists yet. The local Codex allowlist cannot modify Discord mappings or send messages; use the feature UI for these operations.
3. Record only a reply the user actually supplies. Preserve its respondent attribution. A hypothetical answer belongs in discussion, not the reply field.
4. After a reply, propose a precise cancellation-policy paragraph and evidence-based rationale. This creates a proposal, never approval. A corrected reply invalidates the previous proposal.
5. Ask the feature owner to use Review decision and Approve decision in the feature UI. Local Codex cannot execute approval. Receiving a reply or a confident model output is never approval.
6. The paragraph diff is a preview. Nothing publishes to Confluence, updates Jira/Figma, or sends messages automatically. Discord posting is a separate owner-confirmed frontend action. Approved decisions are locked; a new cycle is required for later changes.

Use shared actions for all writes. Native local-agent action results are persisted readbacks. If a tool fails or cancellation interrupts a run, re-read the feature before claiming an outcome or retrying a write. Do not read databases or credentials through shell commands.

Suggested questions: use `create-feature-suggested-questions` only for gaps backed by verbatim excerpts from the feature's captured sources. Use origin `source_question` only when a source itself poses the question; otherwise `agent_finding`. Leave the suggested role null when unclear. Suggestions are unapproved and unsent; editing, dismissing and restoring use `update-feature-suggested-question`. The primary question stays under `update-feature-question`.
