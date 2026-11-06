import { getBrowserCookieSession } from "@agent-native/core/server";
import { createError, type H3Event } from "h3";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function assertLocalCodexRequest(
  environment: string | undefined,
  requestUrl: string,
  origin: string | null,
) {
  if (environment !== "development") {
    throw createError({ statusCode: 404, message: "Not found" });
  }
  const url = new URL(requestUrl);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw createError({
      statusCode: 403,
      message: "Local Codex requires loopback access.",
    });
  }
  if (origin && origin !== url.origin) {
    throw createError({
      statusCode: 403,
      message: "Cross-origin Codex requests are not allowed.",
    });
  }
}

export async function requireLocalCodexSession(event: H3Event) {
  assertLocalCodexRequest(
    process.env.NODE_ENV,
    event.req.url,
    event.req.headers.get("origin"),
  );
  const session = await getBrowserCookieSession(event);
  if (!session) {
    throw createError({
      statusCode: 401,
      message: "Sign in to the local app first.",
    });
  }
  return session;
}
