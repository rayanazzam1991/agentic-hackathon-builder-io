import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("adds conservative progress to existing rows without changing their data", async () => {
  const source = await readFile(new URL("../plugins/db.ts", import.meta.url), "utf8");
  const sql = source.match(/name: "feature-progress-status",\s*sql: `([^`]+)`/)?.[1];
  expect(sql).toBeTruthy();
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE coordination_features (id TEXT PRIMARY KEY, status TEXT NOT NULL, revision INTEGER NOT NULL, data JSONB NOT NULL)");
    await db.query("INSERT INTO coordination_features VALUES ($1, $2, $3, $4)", ["legacy", "approved", 7, JSON.stringify({ question: "preserved" })]);
    await db.exec(sql!);
    const result = await db.query("SELECT status, revision, data, feature_status FROM coordination_features WHERE id = $1", ["legacy"]);
    expect(result.rows).toEqual([{ status: "approved", revision: 7, data: { question: "preserved" }, feature_status: "not_started" }]);
    await db.query("INSERT INTO coordination_features (id, status, revision, data) VALUES ($1, $2, $3, $4)", ["new", "open", 1, "{}"]);
    expect((await db.query("SELECT feature_status FROM coordination_features WHERE id = $1", ["new"])).rows).toEqual([{ feature_status: "not_started" }]);
  } finally {
    await db.close();
  }
});
