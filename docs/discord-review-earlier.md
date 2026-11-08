# Discord question and reply review

This milestone adds human-reviewed question delivery to a standard Discord server text channel. It uses Discord's REST API from server-side actions. There is no public localhost webhook, continuous Gateway listener, automatic DM, or scheduled polling.

## Connect

1. Install the bot in the intended server. For the current demo, the application ID is `1567641543010025483`.
2. In the Discord Developer Portal, open the application's **Bot** settings and obtain its **bot token**. This is different from the client ID, public key, and OAuth client secret. Save it directly in Feature Coordinator's **Settings → API keys**, clicking **Add key**. Set **Name** to `FEATURE_COORDINATOR_DISCORD_BOT_TOKEN`, paste the bot token into **Value**, choose **Just me**, then save. The saved key is labelled **Discord bot token**. Do not put it in a message, source file, environment fallback, or feature description.
3. Give the bot **View Channel**, **Send Messages**, and **Read Message History** in the demo channel. Enable **Message Content Intent** in the bot settings to read ordinary reply contents; larger/verified applications may require Discord approval. Administrator permission is unnecessary.
4. Open an existing live feature review. In **Ask in Discord**, enter the channel link and click **Verify and connect**. The server verifies both the channel's server ID and the bot identity. It does not post anything.

Current demo destination:

- Server ID: `1567817386537648188`
- Channel ID: `1567817498597007531`
- Channel: <https://discord.com/channels/1567817386537648188/1567817498597007531>
- Live evidence review: <http://localhost:8080/features/2cc29e44-0a99-4bcc-933e-c760a0397664>

## Run the first real test

1. Save this question as an **unsent draft**:

   > PO clarification needed for order cancellation: Jira and the Confluence specification currently say 24 hours, while the captured Stitch screen says 48 hours. Which window is approved? If it is 48 hours, should it apply to existing orders or only new orders? The Stitch copy also promises an instant refund; is that approved?

2. Click **Review and send…**. Check the exact text, visible correlation reference, and linked destination. **Send question** performs the external post; use it only when ready to publish that question to the channel.
3. Expect **Question sent · confirmed by readback** and a message permalink. Open that link to verify the actual Discord message.
4. Have the responsible person use Discord's **Reply** on that exact message. An unrelated message in the channel will not be captured as an answer.
5. Click **Check replies**. The app reads the latest 100 channel messages and displays direct human replies with real author IDs and source links. It does not automatically record an answer or approve a business decision.
6. Verify the responder's identity and responsibility. Select **Record this reply**. The server fetches that message again and rejects edited/mismatched replies. The feature should become **Ready for a proposal**, with the source permalink retained.
7. Ask the agent to propose, then review the proposal and approve as the feature owner. Confluence publication remains a preview.

## Failure and coverage behavior

- A missing key produces a setup message. A vault lookup failure produces a storage-unavailable error. These are separate cases.
- Sending requires a frontend request and resource ownership. Agent/tool composition cannot invoke the send action. Sample reviews cannot connect or post.
- A database revision reservation precedes POST. Concurrent send requests cannot both win. The request also uses Discord's `nonce` and `enforce_nonce`, with mention parsing limited to the explicitly reviewed role ID.
- A timeout or failed readback records **Delivery unconfirmed**. The app never automatically reposts. After a minute, **Check replies** may reconcile the exact expected bot message and unique visible reference from the captured batch.
- The latest-100 scan can miss older messages. A full batch shows a coverage warning. No match does not prove delivery failed or that nobody answered. A persistent uncertain delivery needs manual inspection; this milestone intentionally has no resend/reset button.
- Checks are explicit snapshots, not live monitoring. Thread replies, DMs, attachments, reactions, other screens and all channel history are outside this milestone.
- A Discord username does not prove a PO role. Human review is required before recording a reply or approving the resulting decision.
- Tokens are resolved for the current caller; an editor checking or recording replies needs their own authorized bot credential.

## Implementation and verification

- Domain constants and schemas: `shared/features/discord.ts`.
- Scoped API adapter: `server/features/discord-api.ts`.
- Revision checks, delivery reservation/reconciliation, reply matching: `server/features/discord-workflow.ts`.
- Actions: `update-feature-discord`, `send-feature-discord-question`, `check-feature-discord-replies`.
- UI: `app/features/coordinator/DiscordReview.tsx`.
- Settings registration: `server/plugins/discord-secrets.ts`.

Run from `feature-coordinator/`:

```sh
pnpm test server/features/discord-api.test.ts server/features/discord-workflow.test.ts server/features/store.test.ts server/lib/local-codex/local-codex.test.ts
pnpm typecheck
pnpm agent-native:doctor
```

Local browser verification reached the missing-token error using the supplied channel URL. No live Discord post or reply readback has been verified yet. The delivery/reply tests use mocked provider responses; they are not evidence of a successful real Discord connection.


## People and roles

In a connected live review, open **Ask in Discord → People and roles → Load server roles**. Choose the actual server role beside each responsibility and click **Save role mappings**. Unmapped responsibilities are allowed. For the first demo, map **Product owner → @PO** and leave the others unmapped. Everyone and managed bot roles are excluded; this UI does not add/remove Discord members or grant access to the app.

**Reload roles** reports the bot's effective notification permission in the connected channel. A role's `mentionable: false` flag alone does not prevent the bot from notifying it: effective Mention Everyone permission or Administrator can permit it. The app calculates guild role permissions and applies channel overwrites in Discord order (everyone, combined roles, then member). It also requires View Channel and Send Messages. Permission read failures or malformed data show as unverified, never denied.

Draft saving snapshots the mapped recipient without checking notification permission. Before any owner-confirmed send, the server rechecks the role and effective permissions before reserving delivery. A missing role, denied mention, or unverified permission leaves the draft saved and unsent. For a missing role, reload roles, select an available role, save mappings, and save the draft again. For denied permission, ask a server administrator to review existing effective permissions in this channel or choose an authorized recipient. For unverified permission, reload roles and retry later. No Discord permission settings are changed by the app.
Keep **Question owner** set to **Product owner**. Click **Save unsent draft** again to apply its current mapping. The exact message begins with the role mention and the preview identifies **Role to notify: @PO**. Saving a mapping alone preserves old draft/sent recipients. Sending remains an explicit frontend owner action; it revalidates the role and permits only that role ID to notify members. Other role mentions, user mentions, `@here`, and `@everyone` in the question text cannot notify recipients. Discord user notification settings may still affect delivery.

Role listing/mapping is feature-owner only. Deleted or foreign-server roles are rejected, stale revisions fail, and the server stores verified role names/IDs without any token. Automatic reply detection is still a separate future milestone; use **Check replies** in this version.

Verification on November 5, 2026: the real role lookup returned `PO` (`1567957468196110518`), with `mentionable: false`. Product owner was mapped to that role on live review `2cc29e44-0a99-4bcc-933e-c760a0397664`; a page reload retained it and a fresh role read displayed the mentionability warning. The other responsibilities remain unmapped. No message was sent and the previous unsent draft was preserved. Browser proof: `docs/images/discord-po-role-mapping.png`. The three targeted Discord/store suites passed 33 tests; typecheck passed and Doctor was clean. Actual notification delivery remains untested until effective permission is verified and a human confirms sending a new targeted draft.
