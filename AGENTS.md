# Chat — Agent Guide

Chat is the minimal chat-first agent-native app. `/` redirects to shared sign-in, then `/home`, the editable Get started page. Chat lives at `/chat`; new chats start there. Actions carry capabilities; screens exist only for durable workflows.

## Skills

Search with `rg --hidden --follow`; read the exact linked guide before deeper work. `.agents/skills/build-an-app/SKILL.md` — start here for vague requests to create a domain app. `.agents/skills/adding-a-feature/SKILL.md` — cross-area feature checklist. Data/integrations: `.agents/skills/actions/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`. UI: `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`. Agent context/workflows: `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`. Framework: `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"`, `pnpm action docs-search --slug "<slug>"`, `pnpm action docs-search --list`, `pnpm action source-search --query "<pattern>"`, `pnpm action source-search --path <path>`, or `pnpm action source-search --list`. For external-agent integrations, read `pnpm action docs-search --slug "external-agents"`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Normal app data must flow through actions. Keep actions deterministic and focused; use agent chat/AgentSidebar for AI work and follow-ups in the same thread. Keep structured state in SQL and large files in configured storage; persist references only.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver. Never hardcode credentials, webhook URLs, or private/customer data.
- Never fabricate. Report failures and recover; verify writes by reading the row or screen. Navigation is in `<current-screen>`; use `view-screen` for fresh visible-record details.

For custom branding, keep `server/plugins/agent-native-email-branding.ts` aligned: `app.name` appears in transactional email and optional `app.logoUrl` must be an absolute HTTPS URL.

## Application state

- `navigation` describes the view and selected ids. Chat is `chat` at `/chat` and `/chat/<threadId>`; the Get started page is `home` at `/home`; `/` opens shared sign-in/signup.
- Use `navigate` when supported and `view-screen` for a fresh read of visible details; basic navigation is already in `<current-screen>`.

## Building a domain app

Choose the primary workflow and route before editing. Add a domain route under `app/routes/` and set `app.homePath` in `server/plugins/agent-native-email-branding.ts` with `defineAppConfig`. The default Get started page lives at `/home`, and Chat stays at `/chat`; edit `app/routes/home.tsx` when replacing that page with a domain-specific home. Add a static link in `app/components/layout/Sidebar.tsx` before `ChatThreadsSection`; `Header.tsx` uses `APP_TITLE` elsewhere. Shared sidebar and AgentInspector remain.

Use `adding-a-feature` for functional parity and `frontend-design` for a user-facing screen. Keep feature guidance here; do not rewrite `README.md` or `DESIGN.md`. After all edits, run one typecheck, one doctor check, and one browser smoke of the primary workflow, including overlap rejection, cancellation freeing the slot, and authenticated landing. Skip production build and extra test suites.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.

## Local model runtime

In development, the home/chat transports use the app’s loopback-only Codex CLI bridge (`app/lib/agent-transport.ts`), backed by Agent-Native’s native Code runner. Use `gpt-6.1-sol` with low reasoning (light thinking), enforced by the app-owned CLI shim in `scripts/local-codex-bin/codex` because Core 0.223 does not forward that setting. Start with `pnpm dev:local` to select the desktop executable and scoped PATH shim. Reuse the host’s Codex login; do not copy tokens or call Jev/OpenAI API-key providers as a fallback. Local endpoints require browser-cookie authentication and same-origin loopback requests, allow one active turn per caller, and run Codex in read-only mode. Native Code history is stored under ignored `data/local-codex`; client chat uses the existing AgentKit shell. Production retains the standard Agent-Native transport and the planned Jev/OpenAI configuration. Domain actions use the bounded protocol described below; live source reads use the app connections described in Live source import.

## Feature review workspace

The primary route is `/features`, with `/features/<id>` for a review. `/home` redirects there. The shell stays mounted. Features use framework ownable columns/shares, private by default, with public sharing disabled. Sample excerpts are synthetic; live imports are explicitly labelled captured provider text. Owner roles remain manually assigned, not connected company identities. Use the existing Share control for real workspace access. Only the resource owner may approve; editors may record replies and proposals.

| Primary action | Arguments | Purpose |
| --- | --- | --- |
| `delete-sample-features` | `dryRun` (default true) | Maintenance cleanup of owned boolean-sample reviews in the active workspace; atomically removes shares and verifies no samples remain. Hidden from agent tool discovery. |
| `list-features` | none | Bounded accessible review list |
| `create-sample-feature` | none | Private synthetic cancellation mismatch |
| `import-feature-sources` | `jiraUrl`, `confluenceUrl`, `designProvider`; Figma URL or Stitch project/screen IDs | New private review from all selected live sources; no partial save, send or publish. Legacy `includeFigma` callers remain supported. |
| `get-stitch-designs` | optional `projectId` | Bounded existing project or screen IDs/titles through the caller's official Stitch connection |
| `get-feature-discord-roles` | `id` | Owner-scoped read of real server roles for a connected live feature; GET calls only |
| `update-feature-discord` | `id`, `revision`, `change` | Verify a channel, map responsibilities to server role IDs, save an unsent targeted draft, or explicitly record a fetched reply |
| `send-feature-discord-question` | `id`, `revision` | Owner/frontend confirmation posts the exact saved question; reservation and GET readback prevent false success |
| `check-feature-discord-replies` | `id`, `revision` | Explicit latest-100 scan and pending-delivery reconciliation; never auto-records or approves |
| `get-feature` | `id` | Authoritative evidence, question, permissions and revision |
| `update-feature-question` | `id`, `revision`, `change` | Assign, record a supplied reply, or propose a decision |
| `create-feature-suggested-questions` | `id`, `revision`, `questions` (1-5) | Adds unapproved, unsent suggestions with origin, verbatim captured-source evidence and an optional suggested role |
| `update-feature-suggested-question` | `id`, `revision`, `questionId`, `change` | Edit, dismiss or restore one suggestion; never approves or sends |
| `approve-feature-decision` | `id`, `revision` | Owner's proven frontend approval; produces a preview only |
| `view-screen` | none | Navigation plus selected feature details |
| `navigate` | `view` or `path` | Open the feature workspace or a specific local route |

Read `.agents/skills/feature-coordination/SKILL.md` for workflow semantics. SQL schema/migrations belong in `server/db` and `server/plugins/db.ts`; lifecycle transitions in `server/features/lifecycle.ts`; resource access/revision checks in `server/features/store.ts`; wire constants and validation in `shared/features/types.ts`; domain UI in `app/features/coordinator`.

**Question collection.** `data.questions` holds only additional suggested questions (max 20, ids unique, `primary` reserved). The primary question is always projected by `getFeatureQuestions` (`shared/features/questions.ts`) from the legacy `question`, `discord` and row status, which stay authoritative for it and for all Discord delivery history; existing actions keep writing those fields. `askApproval` (permission to ask) is separate from decision approval (`approvedBy`/`approvedAt`). A legacy primary whose delivery left `draft` projects as approved with provenance `legacy_send_confirmation` and no actor/time; no explicit approval was ever stored. Dismissal is editor-reversible via `restore`; a `rejected` ask approval is owner-only and not reopenable by these actions. Recipient selection requires an existing Discord role mapping and stores a role snapshot. No approval or send exists for suggestions yet.

Local Codex's bounded JSON action protocol is in `server/features/local-agent.ts`. It uses the same validated actions with request-scoped identity; it never receives authentication tokens. Its allowlist excludes approval and all outbound integrations. The sidebar and full-page chat use the same supported local runtime. User-facing UI copy belongs in the English catalog's `coordinator` namespace, with framework fallback for other locales. Do not promote synthetic snapshots to live source state.

## Live source import

The feature list has a live import form. It reuses the caller's authenticated Atlassian MCP connection through public `mcp-client` APIs, with provider URL matching, and the scoped Figma provider API runtime. It performs GET/read tools only. Each import creates a new private SQL aggregate; reimport never overwrites a sample or approved review. `data.sample` distinguishes provenance. Source URLs, provider versions, capture times and coverage notes accompany bounded text. Capture is not continuous monitoring. The local agent reads these records through `get-feature`; it does not directly invoke provider tools or receive credentials.

A failed selected source prevents creation. Choosing no design produces a two-source review with a prominent design-unverified notice, never a synthetic replacement. Confluence's statements about a design are reported claims until independently read from Figma. Text layers do not establish actual visibility, geometry or prototype behaviour. Comments, attachments, macros and Jira custom-field acceptance criteria are outside this initial capture scope. Never claim those were reviewed. Source readers and URL validation belong in `server/features/live-sources.ts` and `source-input.ts`; provider-specific response fixtures in adjacent tests.

The UI now explicitly chooses Google Stitch, Figma or no design; Stitch is the current UI default. `includeFigma` defaults apply only for legacy callers without `designProvider`. The Stitch reader in `server/features/stitch.ts` pins the actual Google MCP endpoint, scopes reads to the authenticated principal, allowlists read tools and uses inert, bounded HTML extraction. Only the existing scoped API-key header may be reused for Google-origin asset downloads; never expose it or send it to a CDN/redirect. The saved source identifies the selected screen and text-only coverage. Do not infer image content, actual button visibility or prototype behaviour from the extracted text. See `docs/stitch-live-review.md` in the project root for use and validation.


## Discord review

Live reviews may connect a standard server text channel. Use the registered user-scoped `Discord bot token` secret, never an environment fallback. The server API adapter pins Discord's HTTPS origin, validates IDs and paths, disables redirects, and bounds responses. Only the feature owner through the frontend may post a saved draft after reviewing the exact text and destination. Agents cannot post. Reservation with revision compare-and-set precedes POST; uncertain delivery must be reconciled, never blindly retried. Verify success with a GET of the posted message and persist the message ID. Replies are captured only on explicit latest-100 checks, then separately selected and freshly revalidated before recording with source provenance. A reply is not approval. This is not a Gateway listener or DM integration. See `docs/discord-review.md` in the project root for setup, coverage and live-test instructions.


### Discord people and roles

The People and roles section maps Product owner, Frontend developer, Backend developer and Designer to real Discord roles per feature. The canonical responsibility constants live in `shared/features/participants.ts`, re-exported by `shared/features/types.ts`. Mapping schemas remain optional for existing reviews. Role discovery and mapping writes require feature ownership and use the current caller’s scoped bot credential. Exclude everyone and managed roles, validate IDs against the connected guild before saving, and preserve revision checks. Saving a mapping does not grant app access or change sent messages/existing drafts. New drafts snapshot the mapped role of the current question owner; exact recipient and text are shown before posting. Allow only that snapshotted role in Discord `allowed_mentions`; broad/user/reply-author notifications stay disabled. Saving a draft preserves its explicit recipient without notification checks. Recheck role existence and effective bot channel permissions before POST; distinguish missing, denied, and unverified. Reload roles shows current channel-specific notification eligibility. Use a disabled `useActionQuery` plus explicit refetch for the Load server roles read. No role membership is inferred as business approval, and no Gateway listener is included.
