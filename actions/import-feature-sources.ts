import { defineAction } from "@agent-native/core/action";
import { getRequestOrgId } from "@agent-native/core/server/request-context";
import { ReviewInstruction } from "@shared/features/questions";
import {
  FeatureParticipant,
  FeatureWriteSchema,
  QuestionStatus,
} from "@shared/features/types";

import { getDb, schema } from "../server/db";
import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { readLiveSources } from "../server/features/live-sources";
import { removeFeatureScreenshots } from "../server/features/screenshots";
import { featureWriteReceipt } from "../server/features/receipt";
import { readDiscordSetup, setupToBinding } from "../server/features/discord-settings";
import {
  LiveSourceInput,
  parseSourceLinks,
  SourceLinkError,
} from "../server/features/source-input";
import { getFeature, requireActor } from "../server/features/store";

export default defineAction({
  description:
    "Read a selected Jira story, published Confluence page and optionally a Figma node or selected Stitch screen through the caller's app connections; save a new private live-evidence review only if all selected sources succeed. Never sends or publishes. Reimport creates a separate snapshot review.",
  schema: LiveSourceInput,
  outputSchema: FeatureWriteSchema,
  errors: featureErrors,
  deferLoading: false,
  link: featureLink,
  run: async (input, context) => {
    const actor = requireActor();
    try {
      parseSourceLinks(input);
    } catch (error) {
      throw featureErrors.noWrite(
        error instanceof SourceLinkError ? error.message : "Check the source links and selected design project/screen.",
        "invalid_source",
      );
    }
    // Generate the feature id before reading so the Stitch screenshot is stored
    // under the review it will belong to.
    const id = crypto.randomUUID();
    let snapshot;
    try {
      snapshot = await readLiveSources(
        input,
        context ?? { caller: "frontend" },
        { featureId: id, ownerEmail: actor },
      );
    } catch (error) {
      // Provider bodies, tokens and internal errors must never reach chat or UI.
      const safe =
        error instanceof Error &&
        /^(Connect exactly|The connected Atlassian|The Confluence reader|Jira could|Confluence could|Figma could|Stitch could|Jira,|Confluence,|Figma read failed|A source is|Confluence returned|Screenshot storage|Stitch returned no screenshot|Stitch returned an empty|Stitch returned a screenshot|The stored screenshot)/.test(
          error.message,
        )
          ? error.message
          : "Could not read all source evidence. Check app connections and source access; no review was created.";
      throw featureErrors.noWrite(safe, "source_unavailable", {
        statusCode: 503,
      });
    }
    const discordSetup = await readDiscordSetup();
    try {
      await getDb()
        .insert(schema.features)
        .values({
          id,
          title: `Live · ${snapshot.title}`,
          status: QuestionStatus.OPEN,
          ownerEmail: actor,
          orgId: getRequestOrgId(),
          data: {
            sample: false,
            ...(discordSetup ? { discord: setupToBinding(discordSetup) } : {}),
            sources: snapshot.sources,
            question: {
              text: ReviewInstruction,
              owner: FeatureParticipant.PO,
              reply: null,
              replyBy: null,
              proposal: null,
              rationale: null,
              approvedBy: null,
              approvedAt: null,
            },
            activity: [
              {
                id: crypto.randomUUID(),
                event: "Sources imported",
                actor,
                at: new Date().toISOString(),
                detail:
                  "Read selected sources through the caller's connections. Saved captured text as a new review. No external content was changed.",
              },
            ],
          },
        });
    } catch (error) {
      // The row was not saved. Remove the just-stored screenshot so a failed
      // import cannot leave an unreachable image behind.
      await removeFeatureScreenshots([snapshot.sources]).catch(
        () => console.warn("[import-feature-sources] screenshot cleanup failed"),
      );
      throw error;
    }
    return featureWriteReceipt(
      await getFeature(id),
      "Imported and verified selected live source snapshots. No messages sent or sources modified.",
    );
  },
});
