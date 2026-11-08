# Technical start: Feature Coordinator

## Foundation deliverable

Use Builder.io’s **Agent-Native**, an open-source TypeScript application/agent framework. A browser app and optional installable PWA packaging are separate concerns; the initial milestone is a working local web application using the framework’s shared action architecture.

Official sources checked November 3, 2026:

- [Getting started](https://www.agent-native.com/docs/)
- [Create an app with an agent](https://www.agent-native.com/docs/create-with-an-agent/)

The documented starter command is:

```sh
npx --yes @agent-native/core@latest create feature-coordinator --standalone --template chat
```

Scaffold into `feature-coordinator/` within this workspace, preserving prior documents and experiments. Requirements: Node.js >=22.22 and pnpm. Local inspection found Node.js v24.16.0 and pnpm 10.9.0. Read generated AGENTS.md, dependencies, aliases, bundled version-specific docs, and persistence conventions before writing application code. Use the generated stack rather than replacing it with a separate Vue/Nuxt application.

Then install dependencies with pnpm, start the generated dev script, and verify the actual loopback URL printed by the server. Keys are needed for the application agent to make model calls, not to create the app. Do not report an operational agent merely because the starter page responds.

## Verified foundation

The scaffold and dependencies are installed. The local URL returned HTTP 200; browser local-dev sign-in reached `/home`. Typecheck and Agent-Native Doctor passed. See the [verification report](foundation-report.md), including upstream starter messages and the unexpected initial Git commit that was moved out with the generated metadata. The installed Core version is 0.223.0.

The installed `@agent-native/core/decisions` service already supports Jev typed decisions. Inspect its capability/readiness state and existing credential resolution before adding a custom integration. Prose work belongs in the framework’s agent runtime; avoid putting raw LLM calls inside ordinary application data actions.

## First domain slice after foundation review

Implemented as the sample feature review workspace. See the [hands-on walkthrough](feature-review-walkthrough.md) for startup, sample values, UI steps and checks. Real provider integrations remain the next milestone.

Local model setup is now Codex CLI; see [local runtime setup and boundaries](local-codex.md). Keep Jev typed decisions and OpenAI prose for production. The local runtime is a development chat bridge; shared domain action/tool execution is part of the next slice.

Model records for Feature, SourceSnapshot, Question, Decision, SpecUpdate, MessageDelivery, and Activity. Keep original source/version, reviewer identity, and message correlation on records. SourceSnapshot holds evidence, while Decision records accepted business interpretation; neither replaces the other.

Define exported named `as const` domain objects in the owning type files and derive unions from their values. Define validated lifecycle transitions in shared server actions. Use actual project aliases and owner boundaries. Follow the installed framework’s authorization/database model; do not create a competing persistence system merely for speed.

Example question lifecycle: discovered → reviewed → asking → awaiting reply → answered → awaiting approval → resolved. Delivery failure remains explicit. An answer does not equal approval. Decide exact values and supported transitions when implementing the owning types.

The first complete slice lets the user and agent inspect the same question, change its owner, record a reply, approve a decision, and inspect the proposed Confluence diff. Persist it across refresh. Fixture mode must be labeled and cannot send messages or publish documents.

## Integration order

| Integration | First capability | Later capability |
| --- | --- | --- |
| Confluence | Read one configured page with version and explicit open questions | Publish the reviewed patch with a page-version concurrency check |
| Jira | Read linked stories and acceptance criteria | Role-task linking only after requirement agreement |
| Discord | Send one configured thread question and correlate a reply | Targeted notices and optional DMs |
| Figma | Inspect selected frames and compare saved snapshots on demand | Event-triggered rechecks after reliable manual refresh |
| GitHub | Deferred | Supply implementation evidence |

Company credentials, bot installation, and source/recipient selection are separate from LLM credentials. Connected tools in this chat do not automatically grant the deployed app its own integrations. Test outbound work against explicitly configured destinations.

## Verification by milestone

Foundation: install completes, generated checks/build pass as applicable, dev process starts, actual URL responds. Domain slice: state persists, transitions respect approval, and UI/agent use the same actions. Integrations: inspect real source versions, correlate replies, expose failures, avoid duplicate sends, reject stale publication, and notify only affected owners for material changes.

The previous four-stage PTO evaluation remains historical. Use targeted checks on this new question-resolution workflow as it is implemented; do not make building the app depend on completing an unrelated research harness.
