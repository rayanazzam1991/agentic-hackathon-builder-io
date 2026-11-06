import { LocalCodex } from "@shared/local-codex";
import { describe, expect, it } from "vitest";

import {
  chatHandoffComposerOptions,
  initialComposerOptionsFromState,
} from "@/lib/chat-paths";

describe("local chat handoff", () => {
  it("preserves the Codex selection and strips unset composer fields before validation", () => {
    const input = { engine: LocalCodex.ENGINE, model: LocalCodex.MODEL };
    // Model the runtime payload emitted by the composer despite its stricter TS type.
    Object.defineProperty(input, "effort", {
      value: undefined,
      enumerable: true,
    });
    const options = chatHandoffComposerOptions(input, {});
    expect(Object.prototype.hasOwnProperty.call(options, "effort")).toBe(false);
    expect(
      initialComposerOptionsFromState({ initialComposerOptions: options }),
    ).toEqual({
      status: "valid",
      options: {
        engine: LocalCodex.ENGINE,
        model: LocalCodex.MODEL,
        mode: "act",
      },
    });
  });
});
