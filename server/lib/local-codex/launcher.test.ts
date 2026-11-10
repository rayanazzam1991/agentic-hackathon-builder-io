import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

import { LocalCodex } from "@shared/local-codex";
import { describe, it, expect } from "vitest";
import { selectCodexExecutable } from "../../../scripts/local-codex-executable.mjs";

describe("native CLI launch boundary", () => {
  it("prefers the current desktop CLI over an older PATH installation", () => {
    const chatgpt = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
    const selection = selectCodexExecutable({
      platform: "darwin", path: "/usr/local/bin", shimDirectory: "/shim",
      exists: (path: string) => path === chatgpt || path === "/usr/local/bin/codex",
    });
    expect(selection).toEqual({ executable: chatgpt, source: "desktop bundle" });
  });
  it("forwards stdin/model and pins low reasoning at the actual executable boundary", () => {
    const dir = mkdtempSync(join(tmpdir(), "coordinator-cli-test-"));
    try {
      const executable = join(dir, "fake-codex");
      writeFileSync(
        executable,
        '#!/usr/bin/env node\nlet input="";process.stdin.on("data",chunk=>input+=chunk);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({args:process.argv.slice(2),input})));',
      );
      chmodSync(executable, 0o755);
      const result = spawnSync(
        process.execPath,
        [
          resolve("scripts/local-codex-bin/codex"),
          "exec",
          "--model",
          LocalCodex.MODEL,
        ],
        {
          input: "read-only fixture",
          encoding: "utf8",
          env: {
            PATH: dirname(process.execPath),
            FEATURE_COORDINATOR_CODEX_EXECUTABLE: executable,
          },
        },
      );
      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout);
      expect(out.input).toBe("read-only fixture");
      expect(out.args).toEqual([
        "-c",
        'model_reasoning_effort="low"',
        "exec",
        "--model",
        "gpt-6.1-terra",
      ]);
      writeFileSync(executable, "#!/usr/bin/env node\nprocess.exit(7);");
      const failed = spawnSync(
        process.execPath,
        [resolve("scripts/local-codex-bin/codex"), "exec"],
        {
          encoding: "utf8",
          env: {
            PATH: dirname(process.execPath),
            FEATURE_COORDINATOR_CODEX_EXECUTABLE: executable,
          },
        },
      );
      expect(failed.status).toBe(7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
