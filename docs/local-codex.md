# Local Codex runtime

Local development now uses the host's authenticated Codex CLI for chat. The production plan remains Jev for typed decisions and OpenAI for prose; production keeps the standard Agent-Native transport. The feature domain and selected live source reads are documented in [live source review](live-source-review.md). Discord delivery and GitHub integration remain pending.

## Start locally

```sh
cd feature-coordinator
pnpm dev:local
```

Open the loopback URL printed by the server (currently http://127.0.0.1:8080/), choose local developer sign-in, and send a message from Home or Chat. `pnpm dev` also opens a browser. Both scripts bind to 127.0.0.1.

Run only one dev server for this checkout. Vite also defaults to IPv4 loopback and refuses an occupied port, so a second invocation cannot silently start on another port or IPv6. If `localhost:8080` shows `socket hang up` while `127.0.0.1:8080` works, check for an older IPv6 listener, stop the duplicate server, and use the loopback URL above.

The launcher prefers the CLI bundled in `/Applications/ChatGPT.app` or `/Applications/Codex.app` on macOS, otherwise it uses `codex` on PATH. Use `codex login` with the selected CLI if it is not already signed in. Credentials remain managed by Codex; the app does not copy tokens or require Jev/OpenAI API keys for this local chat path. Codex remains a hosted model service using the host account's access and limits, not offline inference.

The model is defined once as `LocalCodex.MODEL` in `shared/local-codex.ts`. The current setting is `gpt-6.1-terra` with low reasoning. Homebrew CLI 0.143.0 rejected the model; the ChatGPT desktop CLI 0.167.0-alpha.3.2 completed a direct Terra request. No global CLI install or login was changed.

## Boundaries

- The supported `AgentChatRuntime` HTTP adapter uses Agent-Native's public native Code runner with `metadata.engine = codex-cli`. No copied or patched framework internals and no CLI-as-AgentEngine shim.
- Both endpoints require development mode, a loopback host, same-origin requests when an Origin is supplied, and a browser-cookie session. Production requests return 404 before starting any child process.
- Native execution is read-only with one active turn per caller, explicit cancellation, a two-minute timeout, and bounded recent conversation replay. Caller, organization and chat identity scope the native run history.
- Native history lives in ignored `feature-coordinator/data/local-codex/`, configured by `AGENT_NATIVE_CODE_AGENTS_HOME` in local `.env`. Chat display/persistence uses the starter's existing framework facilities.
- Status streams while Codex runs; assistant text appears after the CLI completes. This first bridge accepts text prompts; attachment forwarding, durable background jobs and integration execution are pending. The feature workflow bridge below adds a bounded domain action allowlist.
- Failure is explicit. The local bridge does not fall back to Jev or API-key inference. Existing production provider choices are preserved, not validated by the local test.

The local startup script has narrow Doctor exceptions for PATH and NODE_OPTIONS. These contain executable search paths and Node runtime flags, not application credentials. Model selection is a domain constant rather than a custom credential environment variable.

## Atlassian connection returns HTTP 431

Atlassian MCP OAuth may return a signed state large enough to exceed Node's default 16 KiB request-header limit (which also counts the request URL). The local launcher sets a bounded 64 KiB limit for its child processes, preserving other inherited Node options. This applies to local development only.

If the authorization callback shows HTTP 431, stop the current development server and restart it with `pnpm dev:local` (or `pnpm dev`). Open the app using the same hostname used to begin authorization: `localhost` and `127.0.0.1` have separate browser cookies. Start a fresh Atlassian connection from Settings → Integrations or MCP server; do not reload or copy the old authorization callback URL. Select the Rayan workspace. For the initial source-reading milestone, choose Read and Search without Write where the consent screen allows it. Successful consent alone is not proof of a completed connection: verify the app reports connected and can read KAN-1 and Confluence page 327682.

Do not log or share authorization callback URLs: they contain temporary authorization material. If 431 persists after restarting through the launcher, investigate aggregate cookie/request size before raising the limit again or clearing unrelated localhost data.

## Next step

The [first domain slice](feature-review-walkthrough.md) now implements: one feature question → owner → reply → proposed decision → human approval → proposed specification diff, using shared UI/agent actions. The bounded local action bridge is implemented below. Selected real source reads are now implemented; see [live source review](live-source-review.md) for verified coverage and the Figma rate-limit blocker.

## Feature workflow bridge

The feature review slice now adds a bounded local action protocol over the native Code runner. It validates one structured request at a time and permits only sample creation, accessible listing/reading, and question assignment/reply/proposal. It executes the same framework actions used by the UI under the authenticated request identity. Approval, publication and messaging are excluded. The contextual sidebar now also uses the local runtime. A turn has at most three actions and a two-minute deadline; the model is instructed to use the protocol instead of CLI tools.


## Local launcher correction — November 5, 2026

At that time the app used `gpt-6.1-sol` with light thinking (`low`), and a direct desktop CLI 0.166.0-alpha.6 check succeeded. The current model and launcher selection are documented above. Restart with `pnpm dev:local` after changing the launcher so the running server picks up its PATH.

Core 0.223 accepts `reasoningEffort` but does not forward it in the Codex subprocess arguments. The app-owned executable shim at `scripts/local-codex-bin/codex` adds `model_reasoning_effort="low"`, using the shared local policy, and delegates to the desktop CLI selected by `scripts/dev-local.mjs`. It preserves stdin/stdout, exit status and cancellation signals. No framework package or global Codex configuration is patched. The executable-path environment variable contains no credential. Production still uses its normal transport.

Known model, quota and authentication failures are classified into fixed user-facing messages from the current run leg only. Arbitrary CLI logs are never exposed in the chat error.

Browser readback after the launcher restart: **Ask agent to review** completed in 26 seconds on review `2cc29e44-0a99-4bcc-933e-c760a0397664`. It cited Jira/Confluence/Stitch, identified the 24/48-hour mismatch and unsupported instant-refund promise, reported coverage limits, and left the Discord question unsent. Screenshot: `docs/images/codex-light-review-success.png`. Targeted tests cover launcher argument/stdin/exit-code forwarding and safe error classification alongside the existing authentication, overlap and cancellation tests.
