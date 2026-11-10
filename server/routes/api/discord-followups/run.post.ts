import { createError, defineEventHandler, getHeader } from "h3";
import { timingSafeEqual } from "node:crypto";

import { runDueDiscordFollowUps } from "../../../features/discord-followups";

const MaxPerRun = 5;
const BudgetMs = 8000;

function matchesSecret(header: string, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const actual = Buffer.from(header, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Deterministic worker entry point. The Netlify scheduled function calls this
 * every minute with DISCORD_FOLLOWUPS_SECRET. It never accepts a browser
 * session as authority: each due feature runs under its stored owner identity.
 */
export default defineEventHandler(async (event) => {
  const secret = process.env.DISCORD_FOLLOWUPS_SECRET?.trim(); // guard:allow-env-credential — deployment-level shared worker secret, not a user credential
  if (!secret)
    throw createError({
      statusCode: 503,
      statusMessage:
        "Set DISCORD_FOLLOWUPS_SECRET on the deployment before running follow-ups.",
    });
  const authorization = getHeader(event, "authorization") ?? "";
  if (!matchesSecret(authorization, secret))
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  const result = await runDueDiscordFollowUps({
    max: MaxPerRun,
    deadlineMs: BudgetMs,
  });
  console.log("[discord-followups] run finished", result);
  return result;
});
