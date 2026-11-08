> Historical Feature Memory work: superseded by the Feature Coordinator pivot on November 3, 2026. Its unrun evaluation gate does not block the new application foundation.

# PTO handover evidence experiment

Status: fixtures and offline validation are ready. Model generation and factual evaluation have not run. The build gate is **NOT EVALUATED**; do not start the application foundation based on structural checks.

## Contents and provenance

- `fixtures/`: seven self-contained input packages: A, B, C, D-initial, D-reply, R-refactor, and R-injection. D is one core case with two generation stages.
- `fixtures/images/`: four 1200 × 800 PNG mockups drawn locally with Pillow and system Arial. These are invented reference designs, not actual Figma exports or remotely connected files. Source metadata and visible banners disclose this. The only changed elements are the fixture version, regular-member editing/read-only state, and presence/absence of Archive. Manager editing remains visible in every image.
- `answer-keys/`: reviewer-only expected findings and forbidden conclusions. Never put this directory in a model prompt or give the generation process access to it.
- `contracts/`: frozen-candidate prompt v1.0 and JSON output schema. Pilot findings may require a versioned revision before freezing the final contract.
- `scripts/validate.py`: dependency-free package/schema/reference validation, including limits and image paths/regions. This implements the JSON Schema subset used in the checked-in output schema; it is not a general JSON Schema engine.
- `scripts/prepare.py`: prepares one isolated request directory with the prompt, schema, package, attached-image mapping, and SHA-256 hashes. It does not call a model or copy answer keys.
- `scripts/test_validate.py`: negative integrity tests; its deliberately minimal synthetic brief is validator test data, never a model result.
- `results/`: actual offline validation report, a pending generation/review ledger, and build-gate status. No model output exists yet.

All people, story IDs, decisions, dates, and messages are fictional example data. No actual Jira, Figma, channel, or DM requests were made.

## Run offline checks

From the project root, with Python 3.10 or later:

```sh
python3 experiment/scripts/validate.py
python3 -m unittest discover -s experiment/scripts -p 'test_*.py' -v
```

No dependency installation or API credentials are needed. Pillow is only needed to redraw the already supplied PNG files; checking PNG dimensions uses the standard library.

## Prepare a real model run

The user selected **TypeSafe AI / Jev**. Credentials are pending. Jev uses typed decisions rather than the v1 full-brief generation interface, so the architecture and contract must be adapted before calls. See [integration decision and credential setup](typesafe-integration.md). The user chose Jev decisions plus OpenAI nano prose; the [v2 candidate pipeline](contracts/v2/pipeline.md) specifies the separation. Both API keys and authenticated access checks are pending. The instructions below describe the preserved v1 preparation flow; they are not a compatible Jev API runner. No provider calls have been made.

Prepare a fresh directory, outside the reviewer-key tree, for a pilot:

```sh
python3 experiment/scripts/prepare.py --case A --destination /tmp/feature-memory-pilot-A
```

Send that directory's `request.txt` and the images in `manifest.json` attachment order to the selected image-capable model. The schema is also supplied separately for providers supporting structured output. Do not silently omit images. Run generation without browsing, shell tools, repository access, messaging, or reviewer keys. Record any inability to enforce these restrictions as an evaluation limitation.

For D-initial, use the actual generated C brief; for D-reply, use the actual generated D-initial brief:

```sh
python3 experiment/scripts/prepare.py --case D-initial --prior-brief /path/to/generated-C.json --destination /tmp/feature-memory-pilot-D-initial
python3 experiment/scripts/prepare.py --case D-reply --prior-brief /path/to/generated-D-initial.json --destination /tmp/feature-memory-pilot-D-reply
```

The preparer rejects missing prior outputs, invalid structures/references, text budgets exceeded by carried-forward content, and attempts to overwrite an earlier preparation. A prior-output placeholder must never be sent to the model. All source evidence, including the recorded reply, counts toward package limits. The prior brief also counts toward the 20,000-character text budget; report overflow and review any limit change before a run rather than truncating evidence silently.

Validate actual output against the prepared (runtime-resolved) package:

```sh
python3 experiment/scripts/validate.py --package /tmp/feature-memory-pilot-A/input.json --output /path/to/generated-A.json
```

## Generation and review order

1. Select an available image-capable provider/model and record the exact returned model identifier, configured settings, and access route. An explicit model choice has not been made yet.
2. Run pilots in order A, B, C, D-initial, D-reply, R-refactor, R-injection: seven generations. Review every claim against its source; also use the separate answer key. Preserve failed output and transport errors.
3. If changes are needed, create a new prompt version and retain prior results. Freeze the final prompt/schema/fixture hashes before final evaluation.
4. Run A/B/C three times each and D three times as paired initial/reply generations. For each repetition, C feeds D-initial and D-initial feeds D-reply. No prior output crosses repetitions. Run each regression once. That is twelve core evaluations plus two regression evaluations, comprising seventeen final generations.
5. Record exact raw request/response, image hashes, prompt/schema hashes, returned model ID, settings, UTC start/end, wall-clock latency, usage/cost if reported, output/reference validation, and a separate claim-level factual review. Record unreported cost/usage as unknown, never zero. Keep outputs labeled generated and reviewer corrections separate.
6. In the claim-review ledger, write each claim ID, supporting source excerpt or visual region, and pass/fail rationale. Reviewer IDs/timestamps must identify actual reviews. Check omitted expected findings too: valid citations alone do not prove completeness.
7. Mark a composite D evaluation passed only when both stages pass. All final cases and global criteria must pass before recommending the foundation. Review the recorded result with the user before Step 3.

Structural validation cannot judge whether an excerpt actually supports a statement, whether channel relevance is correct, whether an image was understood, whether every expected finding was covered, or whether a saved correction was semantically preserved. These require recorded factual review. A retained review ID alone does not prove its correction was respected.

## Scope of this delivery

This delivers fixture packages/images, separate answer keys, the candidate versioned contract, preparation tools, and offline validation. The v2 candidate dual-model contract is also prepared. Provider runner implementation, raw generated results, real latency/usage/cost measurements, and the pass/fail recommendation remain pending credentials and execution. See `results/status.md` for the current gate.
