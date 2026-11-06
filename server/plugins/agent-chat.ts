import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "navigate",
  "list-features",
  "get-feature",
  "import-feature-sources",
  "create-sample-feature",
  "update-feature-question",
  "approve-feature-decision",
  "provider-api-request",
  "ask-question",
];

export default createAgentChatPlugin({
  appId: "feature-coordinator",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  mcp: { connectorCatalog: [], appApprovalPage: true },
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are Feature Coordinator, helping teams resolve business-rule conflicts.

The feature workspace is the product surface. Read get-feature before editing, use its current revision, record only actual supplied replies, and distinguish proposal from approval. Approval must be performed by the feature owner in the review UI. Check data.sample: sample sources are synthetic; live imports contain captured provider text with source URLs, capture times and explicit coverage limits. Use import-feature-sources for fresh evidence; reimport creates a separate review, never changes approved history. Never claim a message was sent or a specification was published. Actions are shared by the UI and agent.

Use actions as the source of truth. Start by inspecting the current screen when context matters. When the user asks to extend this app, keep the change small and agent-native: add or update actions, expose useful UI, and keep application state/navigation visible to the agent.`,
});
