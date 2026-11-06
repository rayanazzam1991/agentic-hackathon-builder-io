// Classify known CLI failures; never forward arbitrary stderr or provider payloads.
export function localCodexFailureMessage(
  events: ReadonlyArray<{
    message: string;
    metadata?: Record<string, unknown>;
  }>,
) {
  const errors = events
    .filter(
      (event) =>
        event.metadata?.source === "codex-cli" &&
        event.metadata?.type === "error",
    )
    .map((event) => event.message)
    .join("\n");
  if (/model_not_found|model is not supported/i.test(errors))
    return "Your local Codex CLI rejected gpt-6.1-sol. Restart with pnpm dev:local to use the selected desktop CLI. No production provider was called.";
  if (/usage limit|rate.limit|quota/i.test(errors))
    return "Your Codex account reached its usage limit. Check Codex usage before retrying. No production provider was called.";
  if (/unauthorized|authentication|not logged in|invalid.*token/i.test(errors))
    return "Codex authentication failed. Sign in to Codex CLI again, then retry. No production provider was called.";
  return "Local Codex could not complete this turn. Check the local native run log before retrying. No production provider was called.";
}
export class LocalCodexFailure extends Error {}
