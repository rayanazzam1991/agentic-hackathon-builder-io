import { z } from "zod";
const record = z.record(z.string(), z.unknown());
/** Bounded MCP JSON decoding; provider text stays untrusted data. */
export function unwrapProviderResult(
  value: unknown,
  depth = 0,
): Record<string, unknown> {
  if (depth > 6)
    throw new Error("Provider response nesting exceeds the supported limit.");
  if (typeof value === "string") {
    if (value.length > 1024 * 1024)
      throw new Error("Provider response is too large.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = JSON.parse(JSON.parse(`"${value}"`));
    }
    return unwrapProviderResult(parsed, depth + 1);
  }
  const result = record.parse(value);
  if (result.isError || result.error)
    throw new Error("Provider returned an error.");
  if (Array.isArray(result.content)) {
    const texts = result.content
      .map((v) => record.parse(v))
      .filter((v) => v.type === "text" && typeof v.text === "string");
    if (texts.length !== 1)
      throw new Error("Provider returned an unsupported text envelope.");
    return unwrapProviderResult(texts[0]!.text, depth + 1);
  }
  if (result.structuredContent)
    return unwrapProviderResult(result.structuredContent, depth + 1);
  if (result.data && typeof result.data === "object")
    return unwrapProviderResult(result.data, depth + 1);
  return result;
}
