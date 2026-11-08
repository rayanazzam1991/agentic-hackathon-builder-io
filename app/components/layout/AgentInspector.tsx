import { navigateWithAgentChatViewTransition } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { focusAgentChat } from "@agent-native/toolkit/app/chat";
import { AgentSidebar } from "@agent-native/toolkit/app/chat";
import { type ReactNode, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { FeatureResource } from "@shared/features/types";

import {
  createLocalCodexRuntime,
  LOCAL_CODEX_ENABLED,
  LOCAL_CODEX_COMPOSER_OPTIONS,
} from "@/lib/agent-transport";
import { chatThreadPath } from "@/lib/chat-paths";
import { TAB_ID } from "@/lib/tab-id";

interface AgentInspectorProps {
  children: ReactNode;
  chatHomeHandoffActive: boolean;
  chatHomeHandoffPending: boolean;
}

/** Contextual inspector shell used on secondary chat routes. */
export function AgentInspector({
  children,
  chatHomeHandoffActive,
  chatHomeHandoffPending,
}: AgentInspectorProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const featureId = /^\/features\/([^/]+)\/?$/.exec(pathname)?.[1];
  const t = useT();
  const [runtime] = useState(() =>
    LOCAL_CODEX_ENABLED ? createLocalCodexRuntime() : undefined,
  );

  function openAskAgentFullscreen(threadId?: string) {
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, chatThreadPath(threadId));
  }

  return (
    <AgentSidebar
      {...(runtime
        ? {
            runtime,
            availableModels: LOCAL_CODEX_COMPOSER_OPTIONS.availableModels,
            showMissingApiKeySetup: false,
            showModelSelector: false,
          }
        : {})}
      position="right"
      chatViewTransition
      chatViewTransitionHandoff={chatHomeHandoffPending}
      storageKey="chat"
      scope={featureId ? { type: FeatureResource.TYPE, id: featureId } : null}
      isolateHistoryByScope={!!featureId}
      browserTabId={TAB_ID}
      openOnChatRunning={chatHomeHandoffActive}
      onFullscreenRequest={openAskAgentFullscreen}
      emptyStateText={t("chat.inspectEmptyState")}
      agentPageHref="/settings/agent"
      suggestions={[
        t("chat.inspectSuggestionCapabilities"),
        t("chat.inspectSuggestionHello"),
        t("chat.inspectSuggestionAction"),
      ]}
    >
      {children}
    </AgentSidebar>
  );
}
