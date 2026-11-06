export const LocalCodex = {
  ENGINE: "codex-cli",
  MODEL: "gpt-6.1-sol",
  REASONING_EFFORT: "low",
  ENDPOINT: "/api/local-codex/chat",
  CANCEL_ENDPOINT: "/api/local-codex/cancel",
} as const;

export const LocalCodexCancelStatus = {
  CANCELLED: "cancelled",
  NOT_FOUND: "not-found",
} as const;

export type LocalCodexCancelStatus =
  (typeof LocalCodexCancelStatus)[keyof typeof LocalCodexCancelStatus];

export const LocalCodexRunStatus = {
  COMPLETED: "completed",
} as const;

export type LocalCodexRunStatus =
  (typeof LocalCodexRunStatus)[keyof typeof LocalCodexRunStatus];
