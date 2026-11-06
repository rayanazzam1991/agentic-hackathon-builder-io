import { createHttpAgentChatRuntime } from "@agent-native/core/client/agent-chat";
import { createAgentNativeAgentKitTransport } from "@agent-native/core/client/agentkit-chat/transport";
import { LocalCodex } from "@shared/local-codex";

import { TAB_ID } from "@/lib/tab-id";

export const LOCAL_CODEX_ENABLED = import.meta.env.DEV;

export const LOCAL_CODEX_COMPOSER_OPTIONS = LOCAL_CODEX_ENABLED
  ? {
      selectedEngine: LocalCodex.ENGINE,
      selectedModel: LocalCodex.MODEL,
      availableModels: [
        {
          engine: LocalCodex.ENGINE,
          label: "Local Codex",
          models: [LocalCodex.MODEL],
          modelDisplayNames: {
            [LocalCodex.MODEL]: "Codex · light thinking (local)",
          },
          configured: true,
          isSubscription: true,
        },
      ],
    }
  : {};

export function createAppAgentTransport() {
  return createAgentNativeAgentKitTransport({
    browserTabId: TAB_ID,
    surface: "app",
    adapter: { textFormat: "markdown" },
    ...(LOCAL_CODEX_ENABLED
      ? {
          engine: LocalCodex.ENGINE,
          runtime: createLocalCodexRuntime(),
        }
      : {}),
  });
}

export function createLocalCodexRuntime() {
  return createHttpAgentChatRuntime({
    id: LocalCodex.ENGINE,
    kind: "code-agent",
    label: "Local Codex CLI",
    endpoint: LocalCodex.ENDPOINT,
    cancelEndpoint: LocalCodex.CANCEL_ENDPOINT,
    credentials: "same-origin",
    capabilities: {
      messages: { streaming: true, history: true },
      tools: { events: true },
      models: { selectable: true, reasoningEffort: false },
      cancellation: { abortSignal: true, explicitCancel: true },
    },
    mapRequest: ({ session, turn, turnId }) => ({
      threadId: session.threadId ?? session.id,
      prompt: turn.prompt,
      turnId,
      model: LocalCodex.MODEL,
      reasoningEffort: LocalCodex.REASONING_EFFORT,
      ...(window.location.pathname.startsWith("/features/")
        ? { featureId: window.location.pathname.split("/")[2] }
        : {}),
    }),
  });
}
