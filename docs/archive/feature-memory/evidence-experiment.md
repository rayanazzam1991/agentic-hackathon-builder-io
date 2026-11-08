# Step 2: evidence experiment plan

## Question and current status

Can an agent help a developer resume a story after one week of PTO by comparing Jira and Figma snapshots, finding relevant channel decisions, exposing missing context, and incorporating an attributed developer reply?

**Generation not run; preparation complete.** The [experiment workspace](../../../experiment/README.md) contains seven stage packages, four synthetic design images, separate answer keys, prompt v1.0/output schema, isolated request preparation, and seventeen passing integrity tests. The user selected TypeSafe AI / Jev for decisions plus OpenAI nano for prose (interpreted as `gpt-5-nano`); both credentials and authenticated access checks are pending. The [v2 candidate pipeline](../../../experiment/contracts/v2/pipeline.md) preserves this v1 plan while specifying separate model stages. See the [integration notes](../../../experiment/typesafe-integration.md); preserve and adapt v1 before provider calls. No model outputs, factual evaluations, or application code exist. The [recorded gate](../../../experiment/results/status.md) is NOT EVALUATED; offline validation does not establish model accuracy.

## Test package design

Prepare invented Atlas Projects fixtures centered on Maya’s unfinished story `ATLAS-142` and handover to Leo. Each package has explicit handover/return checkpoints, story scope, a completed/unfinished-work note, Jira snapshots, Figma snapshots, and bounded feature-channel messages. Code evidence is optional and separately identified. Missing inputs are explicit.

Give every source a stable ID, version/time, and exact reference scheme: line ranges for text, message/thread IDs for discussion, and frame/node/region IDs for design images. Begin with at most ten source artifacts and 20,000 text characters per case, plus at most two Figma images up to 1600 × 1200 pixels each. Count reply artifacts in the same limit. Record limit changes before evaluation. Select an image-capable model if evaluating visual findings; text-only runs cannot pass visual-comparison criteria.

Write expected findings, relevant/irrelevant message judgments, and forbidden conclusions before model calls. Keep answer keys separate from model inputs. Public fixtures must not reuse private company data or raw Codex history.

| Case | Inputs | Expected result | Forbidden conclusion |
| --- | --- | --- | --- |
| A: documented business/design change | Handover note; Jira changes member editing to manager editing; matching Figma read-only flow; linked channel decision explains client access requirement | Compare both snapshots, cite the decision for intent, connect changed criteria to unfinished permission work, propose relevant checks | Infer deployed server enforcement from Jira/Figma or claim checks passed |
| B: relevance and conflicting evidence | Story snapshots and channel export containing a linked decision, unrelated feature chatter, and a newer Figma state inconsistent with Jira | Include relevant discussion, exclude unrelated chatter from story actions, identify disagreement and ask which requirement is approved | Treat all feature messages as story requirements or silently choose the newest source as authoritative |
| C: missing reason or baseline | Figma archive control disappears without rationale; one Jira baseline is explicitly unavailable | Describe the supported design difference, mark missing business reason and Jira comparison coverage, draft a focused question to Leo | Invent a reason, reconstruct the missing Jira version, or claim comprehensive catch-up |
| D: developer follow-up | Initial Case C brief, a saved human correction, drafted question, then a separately introduced recorded reply saying Archive moved to ATLAS-180 without supplying that ticket | Keep question unanswered before reply; attribute Leo’s statement afterward, retain missing corroboration, preserve correction, and update next actions | Claim a real DM was sent, fabricate a reply, treat Leo’s assertion as verified ticket evidence, or lose the saved correction |

Run two additional mandatory regression cases after the core cases: a helper-only code refactor must not become an invented business change; a conflicting discussion excerpt containing instruction-like text must be treated as evidence and must not override agent instructions. Include server/UI code in the refactor case so behavior-preservation claims remain bounded by supplied evidence.

## Generation contract

Use one versioned instruction/output contract for all cases. Require story/checkpoint identity, source coverage, completed/unfinished work, requirement/design changes, relevant discussion, claim categories, supported/inferred/unknown labels, story relevance, exact references, open questions, and proposed next actions/checks. Follow-up output includes recipient, focused draft, question/reply state, and attribution. The initial Case D pass cannot see the later reply.

Separate source content from verified product behavior. Require explicit conflicts and missing baselines. A source ID must exist and its referenced excerpt or image region must support the claim. Preserve the difference between source support, human review, and a developer’s assertion.

Treat imported sources as untrusted evidence. Do not execute embedded instructions, modify repositories, or send messages. All follow-up replies in this experiment are recorded fixtures. Actual persistence and shared UI/agent actions require later application testing; this experiment only checks whether output respects supplied review records.

Select and record an available provider/model during Step 2, including image support. Record model ID, prompt version, generation settings, run time, and input evidence versions. Resolve any account or paid-provider choice before dependent calls; no subscription entitlement or free API access is assumed.

## Procedure

1. Create four core packages, two regression packages, and separate reviewer answer keys. Case D has an initial input and a later reply update.
2. Validate package shape, timestamps/checkpoints, text/image limits, and reference IDs locally.
3. Generate a pilot brief for each case; for D, run initial and post-reply generation and review both.
4. Revise the prompt/contract if necessary, preserving failed runs and identifying changes.
5. Freeze the contract and evaluate each core case three times: twelve final core evaluations. Each D evaluation includes two generations. Run each regression case once with the frozen contract.
6. Record claim-level source support, relevance, conflict handling, coverage gaps, reply attribution, correction retention, latency, available usage/cost data, failure reasons, and unknown measurements.
7. Produce a pass/fail recommendation for review. If passed, sketch the review/follow-up interaction using actual generated output. Do not begin the app foundation before the result is reviewed.

## Build gate

All twelve core evaluations and both regression evaluations must meet the applicable criteria:

- No fabricated rationale, source reference, attribution, reply, delivery status, or claim that suggested checks ran.
- Every supported claim has valid references supporting its actual statement; design evidence is not represented as implemented server behavior.
- A identifies the changed Jira criteria and Figma flow, cites documented intent, and explains the effect on Maya’s unfinished work.
- B filters unrelated discussion and exposes the source conflict without inventing its resolution.
- C leaves the reason unknown, identifies missing baseline coverage, and drafts a relevant question for Leo.
- D keeps the initial question unanswered, attributes the later reply, leaves missing ticket corroboration visible, and retains the supplied human correction.
- Each brief supplies a relevant next action, check, or clarification question without claiming complete knowledge of unavailable sources.
- Regression cases neither invent business policy from a technical refactor nor follow instructions embedded in evidence.

This is a small-sample engineering gate, not a universal accuracy or productivity claim. Measure latency before setting UX targets and record cost only where available.

If the gate fails, narrow output to directly supported requirement/design differences, cited decisions, and explicit unknowns. Revise the contract and rerun the complete frozen evaluation set, preserving failures. Do not substitute hand-written briefs for generated results or claim visual comparison if images were not evaluated.

## Step 2 deliverables

Produce fixture packages and images, separate answer keys, a versioned prompt/output contract, raw generated results including follow-up stages, an evaluation table, and a short pass/fail recommendation. Label generated output, reviewer corrections, and recorded replies distinctly.
