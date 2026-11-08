# Jev integration decision

Provider selected by the user: TypeSafe AI / Jev, November 2, 2026. The API key will be supplied separately. No authenticated calls have run.

## Verified interface

Official sources checked November 2, 2026:

- [Introduction](https://docs.typesafe.ai/introduction): Jev returns typed decisions rather than generated prose.
- [Quick start](https://docs.typesafe.ai/introduction/quickstart): use `TYPESAFE_API_KEY`; the HTTP endpoint is `POST https://api.typesafe.ai/v1/systemone` with bearer authentication and `state`, `model`, and named `questions`.
- [Choice](https://docs.typesafe.ai/primitives/choice): select from supplied options, with probabilities and confidence.
- [API reference](https://api.typesafe.ai/redoc): `GET /v1/models` discovers available model names; image assets require image-capable model support.

The existing v1 contract asks a general text-generation model to produce a full brief JSON object. It cannot be sent unchanged to Jev and called a compatible run. The fixture evidence and separate reviewer keys remain useful.

## Selected architecture

The user selected **Jev for decisions plus OpenAI nano for prose**. Interpret the model request as `gpt-5-nano`; preserve this choice rather than automatically replacing it with another model family. Actual account access remains unverified.

The [v2 candidate contract](contracts/v2/pipeline.md) separates Nano discovery, Jev evidence/relevance decisions, Nano prose, and a final Jev prose check. It preserves the original v1 contract, fixtures, and answer keys. No provider runner or authenticated requests exist yet. Thresholds and request counts are proposed for pilot evaluation, not measured results.

Both `TYPESAFE_API_KEY` and `OPENAI_API_KEY` are pending. Provider/model roles and candidate settings are recorded in [v2 config](contracts/v2/config.json). The prose model receives actual evidence, typed decisions, and human corrections; it cannot upgrade an uncertain finding to a factual conclusion. Final checking and separate human evaluation must catch unsupported additions and missed findings.

## Credential setup

Place the real key in `.env.local` using the variable name from `.env.example`, or make it available as `TYPESAFE_API_KEY` in the process environment. Supply `OPENAI_API_KEY` separately for the prose stage. `.env.local` is ignored. No dotenv loader has been implemented yet; the runner must explicitly load local credentials or receive the environment variable. Never include credentials in fixture packages, request manifests, raw response logs, or documentation.

After credentials are available: verify account access with the model-list endpoint, select/record an exact available image-capable model, adapt and validate the request/response contract, run pilots, review/freeze, and run the final evaluation. Preserve unknown usage/cost as unknown; no model availability or accuracy is assumed from documentation alone.
