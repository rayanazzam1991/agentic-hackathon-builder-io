import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export function selectCodexExecutable({ platform, path, shimDirectory, exists = existsSync }) {
  const desktopCandidates = [
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    "/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  ];
  const desktop = platform === "darwin" && desktopCandidates.find(exists);
  if (desktop) return { executable: desktop, source: "desktop bundle" };
  const executable = path.split(delimiter)
    .filter((directory) => directory && directory !== shimDirectory)
    .map((directory) => join(directory, "codex"))
    .find(exists);
  return executable ? { executable, source: "PATH" } : undefined;
}
