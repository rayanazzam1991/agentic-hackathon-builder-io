# Feature Coordinator

Feature Coordinator helps teams review a feature across specifications, stories, and design, turn discrepancies into questions, and record decisions with human approval. It is the project for the Builder.io hackathon; this repository contains both the application and its supporting material.

## Run locally

Requires Node.js 22.22 or newer and pnpm 10.29.1.

```sh
pnpm install
cp .env.example .env
pnpm dev:local
```

Open <http://127.0.0.1:8080/features>. Local agent chat uses the host's signed-in Codex CLI; live source integrations require their own configured connections. Never commit credentials or local application data.

## Try the workflow

Start a sample review to explore the question, reply, proposal, and owner-approval flow. Live reviews can capture selected source content and support individually reviewed Discord questions. Captures are snapshots, not continuous monitoring; publication to Confluence remains a preview. See the [review workflow](docs/discord-review.md) and [live source notes](docs/live-source-review.md) for setup and coverage.

## Project materials

- [Product brief](docs/mvp-brief.md) and [demo storyboard](docs/demo-storyboard.md)
- [Review walkthrough](docs/feature-review-walkthrough.md) and [verification evidence](docs/feature-review-verification.md) describe earlier milestones; their integration status and old `cd feature-coordinator` instructions are historical.
- [Previous Feature Memory experiment](experiment/README.md) is retained as historical work.

Run `pnpm typecheck` and `pnpm test` for local checks. This repository currently has no Git remote configured; a remote and a reviewed commit are needed before sharing the source with judges.
