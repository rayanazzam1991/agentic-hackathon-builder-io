# Feature Coordinator

Keep a feature’s business requirements, API contract, and design aligned by turning open questions into tracked, owned decisions.

The user selected this competition direction on November 3, 2026. A feature links its Confluence specification, Jira stories, selected Figma designs, and Discord owners/thread. The agent identifies explicit questions and possible disagreements, follows up with the right owner, proposes a specification update, records human approval, and informs affected teammates.

## Start here

- [MVP brief](docs/mvp-brief.md): current product scope and workflow.
- [Technical start](docs/technical-start.md): foundation, shared actions, and integration order.
- [Demo storyboard](docs/demo-storyboard.md): one question-to-approved-decision loop.
- [Acceptance checklist](docs/acceptance-checklist.md): evidence for working capabilities.
- [Validation plan](docs/evidence-experiment.md): checks for the new workflow.

## Delivery status

| Step | Deliverable | Status |
| --- | --- | --- |
| 1 | Product pivot and local Agent-Native foundation | Complete: installed, HTTP/browser smoke, typecheck and doctor passed; awaiting review |
| 2 | Persisted feature/question/reply/decision loop through shared UI and agent actions | Pending |
| 3 | Confluence/Jira reading and model-backed question extraction | Pending |
| 4 | Discord send/reply and approved Confluence publication | Pending |
| 5 | Figma change checks, targeted notices, reliability, developer trial, and demo | Pending |

## Run locally

Start the app from the project root:

```sh
cd feature-coordinator
pnpm dev:local
```

Open [http://127.0.0.1:8080/](http://127.0.0.1:8080/). Keep one dev server running per checkout; stop the existing server before restarting. The server binds to IPv4 loopback and fails if its port is already occupied.

See the [foundation verification report](docs/foundation-report.md) for checks, known starter messages, and Git handling. The application agent still needs a model connection; the coordination workflow and service integrations have not been implemented.

## Previous work

[Feature Memory](docs/archive/feature-memory/overview.md) and its [experiment assets](experiment/README.md) are retained as historical work. No provider evaluations ran. The previous experiment gate does not block this new foundation. Jev for typed decisions and OpenAI nano for prose remain the selected model roles; actual model/account access is unverified.

## Working agreements

Use Agent-Native’s installed conventions and shared actions for agent and UI behavior. Keep steps reviewable; propose the commit scope/subject before committing and do not treat commit approval as next-step authorization. Preserve unrelated work. Public demo data is invented/labeled; real company sends and publication require configured destinations and explicit scope. Provider credentials are server-side and never included in source evidence or logs.

Official setup: [Agent-Native getting started](https://www.agent-native.com/docs/). Recheck [competition rules](https://www.builder.io/hackathon/rules) before submission.
