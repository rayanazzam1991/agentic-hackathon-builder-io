# Discord follow-ups

One optional, automatic follow-up per sent question. The owner opts in while
reviewing the send, chooses 1–3 hours, and sees the exact follow-up text, the
recipient and the channel before confirming. The schedule is saved only after
the original message is confirmed by readback. Nothing is sent at opt-in or
cancel time.

## How a reply stops it

The follow-up is a Discord **reply** to the original message
(`message_reference.message_id`). A reply qualifies only when it is:

- an explicit reply to that original message, in the same channel, from a
  non-bot author, with non-empty text; and
- **individual recipient:** authored by that exact Discord user; or
- **role recipient:** authored by a member who currently has the reviewed role.
  Membership is fetched fresh from the guild for each distinct reply author.
  A role is never treated as an answer just because someone posted in the
  channel, and the role mapping is never inferred from a message.

A qualifying reply stops the follow-up and is shown with its author and time.
It does **not** record an answer, propose a decision or approve anything; those
remain explicit actions in the app.

Coverage: the worker pages backwards up to 500 messages (5 × 100) until it
reaches a message older than the original. If it cannot reach the original, the
state becomes **unverified** and nothing is sent automatically. If member
membership cannot be read, it is also **unverified**. The owner can recheck
later or cancel. Other replies (not from the selected individual, or from
someone who does not currently hold the role) do not stop the follow-up.

A reply can still arrive after the final pre-POST check and before Discord
accepts the message. The worker rechecks immediately before POST, but that
window cannot be closed; if a follow-up posts in that window it is not deleted
automatically.

## State

`scheduled` → (worker claim) `sending` → `sent`; or `answered`, `cancelled`,
`failed`, `uncertain`, `unverified`.

- `failed` means Discord refused before creating a message (validation,
  authentication, permission, 400/401/403/404/429). No message was posted.
- `uncertain` means a timeout, transport failure, 5xx or readback mismatch may
  have happened after Discord accepted the POST. It is never reposted
  automatically; the worker reconciles by finding exactly one matching message.
- `unverified` means the reply coverage or membership could not be established.
  Nothing was sent. The owner can recheck or cancel.
- `answered` means a qualifying reply arrived. Nothing was sent.

Only one automatic follow-up can ever be sent for a question. A `sent` or
`uncertain` record is terminal. A `failed` or `cancelled` record can be
rescheduled by the owner; no second message exists in those states.

## At-most-once

The schedule lives on the question's Discord thread in the feature JSONB
aggregate. The worker claims a due follow-up with a revision compare-and-set
(`scheduled` → `sending`, a two-minute lease, attempt counter) **before** any
network call. Only the claim winner may POST. Concurrent workers lose the
compare-and-set and skip. A crash leaves `sending`; after the lease expires the
worker reads the channel for a matching message and marks `sent` or `uncertain`
— it never reposts. The POST uses a nonce, a message reference and
`fail_if_not_exists`, and the result is read back before `sent` is stored.

Before POST the worker rechecks the channel and bot identity, the snapshotted
recipient's current notification permission, the original message, the question
text, the recipient, ask approval and question status. A changed snapshot is
cancelled. Sent questions are already immutable in the app; the snapshot check
is a second guard for any future edit path. Cancelling a follow-up that is
already `sending` is refused so the UI never claims to have stopped a message
that may be in flight.

## Scheduler and deployment

The intended deployment is Netlify. `agent-native build` already emits the
framework's minute scheduler; this feature adds its own Netlify scheduled
function in `scripts/emit-followup-scheduled-function.mjs` via the
`postbuild` script. The route is listed in the auth plugin's `publicPaths` so the platform can
reach it without a browser session; the route itself requires the bearer secret
and rejects every other request. Without `DISCORD_FOLLOWUPS_SECRET` the route
returns 503 and the function throws; nothing is sent.

The function:

- runs every minute (`schedule: "* * * * *"`);
- calls `POST /api/discord-followups/run` with
  `Authorization: Bearer $DISCORD_FOLLOWUPS_SECRET`;
- the route processes at most 5 due follow-ups within an 8-second budget and
  returns counts. The next minute continues any remainder.

Required production environment variables:

| Variable                    | Purpose                                      |
| --------------------------- | -------------------------------------------- |
| `DISCORD_FOLLOWUPS_SECRET`  | Authenticates the scheduled function to the route. Never logged. |
| `URL` / `APP_URL`           | Base URL the function calls. Netlify sets `URL`. |

Verify the build actually emits the function:

```bash
NITRO_PRESET=netlify pnpm build
ls .netlify/functions-internal/feature-coordinator-discord-followups.mjs
```

Deploy with the same `--functions=.netlify/functions-internal` directory used
for the normal Netlify deploy. Netlify invokes the schedule on its own clock;
the app does not need a browser open.

**Local development is not a durable scheduler.** `pnpm dev` does not start the
follow-up loop, and no interval runs in the browser. Local verification calls
`runDueDiscordFollowUps` directly in tests with a fake clock; a manual run needs
the secret-protected route and a local `DISCORD_FOLLOWUPS_SECRET`. Do not
describe the feature as automatically running in production unless the
scheduled function is present in the deployed functions directory and the
secret is set.

Timing precision is about one minute (Netlify cron granularity) plus processing
time. A due follow-up is not sent early.

## Development safety

Tests mock Discord and the database; no test or browser smoke check sends a
real Discord message or uses a real channel. The browser smoke test stops at the
opt-in dialog. The domain resolver uses the owner's existing scoped
`FEATURE_COORDINATOR_DISCORD_BOT_TOKEN`; this feature adds no Discord
credential and logs no token or secret.

## Verification

```bash
pnpm vitest run server/features/discord-followups.test.ts \
  server/features/discord-question-delivery.test.ts \
  server/features/discord-workflow.test.ts
pnpm typecheck
```

The follow-up tests cover: before deadline, no reply, individual and role
replies, non-member replies, incomplete coverage, missing permission,
unavailable verification, cancellation, restart/crashed claim, concurrent
workers, uncertain POST reconciliation without repost, and a changed question.
