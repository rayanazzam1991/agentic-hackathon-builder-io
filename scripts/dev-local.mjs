import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { selectCodexExecutable } from "./local-codex-executable.mjs";

// Prefer the CLI shipped with Codex on macOS; an older Homebrew CLI may not
// understand the desktop account's model catalog. Other hosts use PATH.
// guard:allow-env-credential — PATH is the host executable search path, not a credential; preserve it for local startup.
const inheritedPath = process.env.PATH ?? "";
// Atlassian MCP OAuth returns a long signed state in the callback URL. Node
// counts the request target toward its header limit; its 16 KiB default can
// reject that callback before the app receives it. Keep a bounded local limit.
// guard:allow-env-credential — NODE_OPTIONS contains Node runtime flags, not credentials.
const inheritedNodeOptions = process.env.NODE_OPTIONS ?? "";
const shimDirectory = fileURLToPath(
  new URL("./local-codex-bin/", import.meta.url),
);
// Load the app's local environment so explicit key material (for example
// SECRETS_ENCRYPTION_KEY) reaches the dev server process, not just Vite's
// client-side env.
const appEnvPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(appEnvPath)) process.loadEnvFile(appEnvPath);
const selection = selectCodexExecutable({ platform: process.platform, path: inheritedPath, shimDirectory });
if (!selection)
  throw new Error("Install Codex CLI before starting the local agent.");
const env = {
  ...process.env,
  NODE_OPTIONS: `${inheritedNodeOptions} --max-http-header-size=65536`.trim(),
  FEATURE_COORDINATOR_CODEX_EXECUTABLE: selection.executable,
  PATH: `${shimDirectory}${delimiter}${inheritedPath}`,
};
console.log(
  `Local agent: Codex CLI (${selection.source}); no production-provider fallback.`,
);
const child = spawn(
  "pnpm",
  [
    "exec",
    "agent-native",
    "dev",
    "--host",
    "127.0.0.1",
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    env,
  },
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(`Local dev startup failed: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
