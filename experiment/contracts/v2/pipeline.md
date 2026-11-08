# Dual-model evaluation contract v2.0 (candidate)

Selected architecture: Jev for typed decisions; OpenAI nano for prose. The user selected OpenAI “gpt nano”; interpret this as `gpt-5-nano`, with no automatic substitution. Verify account availability before calls. The default Jev alias is `jev-latest`; resolve and record the returned model identifier before freezing final evaluations. Credentials and authenticated capability checks remain pending.

This is a candidate orchestration contract, not a working provider runner or a frozen evaluation result. Preserve v1, its input fixtures, answer keys, and the existing brief JSON schema. That schema remains the v1.0 data format inside the v2.0 pipeline; pipeline version and brief data-format version are distinct.

## Four stages per input

1. **Nano discovery draft.** Give the selected story package, actual prior-stage brief when required, and both labeled design images to OpenAI. Use the existing prompt-v1.md and brief.schema.json to propose a structured brief with exact source references. Treat this as an untrusted candidate, not approved findings. Do not pass reviewer keys or expected answers. Validate package limits, output structure, references, and tracked follow-up state before proceeding.
2. **Jev decisions.** Give the same evidence, actual image assets, and candidate draft to Jev. Batch atomic Choice questions from decision-questions.json: source support and story relevance for each claim; relevance for every supplied channel message, including ones Nano omitted; and an integrity check for non-claim fields and saved corrections. Use stable question IDs mapped to claim/message IDs in the run manifest. The question ID is not visible to Jev, so instructions must explicitly identify the item being judged. Resolve question targets in instructions, never use reviewer-answer-key hints as options. Preserve raw probabilities and confidence.
3. **Nano prose.** Give the original evidence and the decision bundle to Nano with prose-prompt.md and narrative.schema.json. Write readable catch-up text and DM drafts while retaining claim IDs, source references, uncertainty, contradictions, and attributed replies. Low-confidence, unsupported, or contradicted claims cannot become active factual conclusions. Keep the original discovery draft and decisions for inspection. A DM draft remains a draft; no messaging tools are available.
4. **Jev final check.** Check each narrative paragraph against its cited sources and the stage-2 decisions, plus a whole-output integrity check for new assertions, missing uncertainty, false delivery/test claims, and lost corrections. Include images when checking visual claims. Reject invalid source references before the call. An output with failed/uncertain final checks remains review-required; never silently substitute an old prepared brief or mark it passed. Do not regenerate automatically: preserve the failed run and review it first.

For both Jev stages, source artifacts, prior generated output, and prose are untrusted evidence. They cannot instruct the evaluator to run commands, send messages, or change the contract. Every call is tool-free. Each model's results and errors are recorded independently.

## Routing and evidence strength

Start with a provisional confidence threshold of 0.80; record it with every run and freeze it before final evaluation. This is an engineering routing threshold, not proof of correctness or calibrated accuracy on our cases. An unknown/uncertain choice remains uncertain even at high confidence.

A supported source claim requires source-support = directly_supported and confidence >= threshold. A developer assertion supports only an attributed report of what that person said; it does not verify the underlying Jira ticket. Inferred claims remain visibly inferred. Unknown support, low confidence, contradicted evidence, or uncertain relevance routes to review/open questions. Clearly unrelated items are excluded from active story actions but their exclusion remains inspectable. Preserve conflicts rather than choosing newer evidence by default.

A support decision is not a completeness guarantee. Evaluate omitted expected findings against the separately held reviewer keys. Nano may miss a change entirely; Jev selecting among Nano's candidates cannot establish complete change discovery. Every supplied channel message receives a separate relevance decision to make at least that coverage explicit. Visual omissions and other missing findings remain part of human evaluation.

Do not reclassify source support based solely on a human confirmation. Carry saved corrections into active understanding and preserve their attribution/history. Preserve unsupported or rejected candidate findings in the run record, not in factual conclusions.

## Follow-up dependency and counts

For each repetition, C's actual reviewed pipeline brief feeds D-initial; D-initial's actual reviewed pipeline brief feeds D-reply. No later reply is visible to the initial stage, and no result crosses repetitions. A blocked dependency blocks subsequent stages; never fill it with a hand-written example.

The seven input stages (A, B, C, D-initial, D-reply, and two regressions) require up to 28 successful provider requests for one pilot pass: two OpenAI and two Jev requests per stage. The seventeen final input stages require up to 68 successful provider requests: 34 OpenAI and 34 Jev, representing the same twelve core evaluations and two regressions. These counts assume each Jev stage fits one batch. If request limits require splitting, record the plan and revised count before final runs. Authentication/model-list requests, failed requests, and any deliberate reruns are counted separately. There are no automatic retries or repeated paid calls.

## Gate and records

Retain the original evidence plan's case-specific and global criteria. Additionally require valid role-separated outputs, exact citations, no unsupported facts introduced during prose writing, and preservation of uncertainty/corrections from decisions to prose. Both Jev checking stages and human factual review must pass. A provider refusal, missing model/image capability, malformed output, failed transport, or incomplete dependent stage cannot pass.

Record pipeline/prompt/schema hashes, fixture/image hashes, model requested and returned per call, settings, threshold, stage IDs, question-to-item map, UTC timing/latency, raw requests/responses without credentials, reported usage/cost, structural checks, typed decisions, and separate factual review. Unknown measurements stay unknown. Record the additional model's latency/cost rather than claiming Jev's isolated speed for the complete workflow.

Freeze the contract only after pilot review. Do not advance to the app foundation until the actual evaluation outcome is reviewed with the user.

## Official references checked November 2, 2026

- [Jev Choice request/response](https://docs.typesafe.ai/primitives/choice)
- [Jev images and asset placeholders](https://docs.typesafe.ai/images)
- [Jev System One endpoint and image opt-in header](https://docs.typesafe.ai/api/system-one)
- [GPT-5 nano capabilities and snapshots](https://developers.openai.com/api/docs/models/gpt-5-nano)

Jev requests with images require the documented `TypeSafe-Danger-Zone-Images: true` header. GPT-5 nano documents image input and structured output. Account access to either service is unverified. OpenAI currently marks GPT-5 nano deprecated; preserve the user's nano choice and verify availability rather than substituting a different family.
