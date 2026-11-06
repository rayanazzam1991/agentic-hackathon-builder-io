import { PGlite } from "@electric-sql/pglite";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, afterAll, it, expect, vi } from "vitest";

import * as schema from "../db/schema";
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../db", async () => ({
  schema: await import("../db/schema"),
  getDb: () => state.db,
}));
vi.mock("./store", () => ({ requireActor: () => "owner@example.test" }));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: (table: typeof schema.features) =>
    and(
      eq(table.ownerEmail, "owner@example.test"),
      eq(table.orgId, "workspace-test"),
    ),
}));
import cleanup from "../../actions/delete-sample-features";
const client = new PGlite();
beforeAll(async () => {
  await client.exec(
    `CREATE TABLE coordination_features (id text primary key,title text not null,status text not null,revision integer not null,data jsonb not null,owner_email text not null,org_id text,visibility text not null); CREATE TABLE coordination_feature_shares (id text primary key,resource_id text not null,principal_type text,principal_id text,role text,created_by text,created_at text,notified_at text);`,
  );
  const db = drizzle(client, { schema });
  state.db = db;
  await db.insert(schema.features).values([
    {
      id: "sample",
      title: "Sample",
      status: "open",
      revision: 1,
      data: { sample: true } as never,
      ownerEmail: "owner@example.test",
      orgId: "workspace-test",
      visibility: "private",
    },
    {
      id: "live",
      title: "Sample-looking live title",
      status: "open",
      revision: 1,
      data: { sample: false } as never,
      ownerEmail: "owner@example.test",
      orgId: "workspace-test",
      visibility: "private",
    },
    {
      id: "foreign",
      title: "Sample",
      status: "open",
      revision: 1,
      data: { sample: true } as never,
      ownerEmail: "other@example.test",
      orgId: "workspace-test",
      visibility: "private",
    },
    {
      id: "other-workspace",
      title: "Sample",
      status: "open",
      revision: 1,
      data: { sample: true } as never,
      ownerEmail: "owner@example.test",
      orgId: "different",
      visibility: "private",
    },
    {
      id: "malformed",
      title: "Sample",
      status: "open",
      revision: 1,
      data: { sample: "true" } as never,
      ownerEmail: "owner@example.test",
      orgId: "workspace-test",
      visibility: "private",
    },
  ]);
  await client.exec(
    "INSERT INTO coordination_feature_shares (id,resource_id) VALUES ('sample-share','sample'), ('live-share','live')",
  );
});
afterAll(() => client.close());
it("previews without writing, then removes only owned boolean samples and their shares", async () => {
  const preview = await cleanup.run({ dryRun: true });
  expect(preview.reviews.map((row) => row.id)).toEqual(["sample"]);
  expect(preview._receipt.changed).toBe(false);
  expect(
    await (state.db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.features)
      .where(
        inArray(schema.features.ownerEmail, [
          "owner@example.test",
          "other@example.test",
        ]),
      ),
  ).toHaveLength(5);
  const result = await cleanup.run({ dryRun: false });
  expect(result.reviews.map((row) => row.id)).toEqual(["sample"]);
  expect(result.remainingSamples).toBe(0);
  expect(result._receipt.verified).toBe(true);
  const db = state.db as ReturnType<typeof drizzle>;
  expect(
    (
      await db
        .select({ id: schema.features.id })
        .from(schema.features)
        .where(
          inArray(schema.features.ownerEmail, [
            "owner@example.test",
            "other@example.test",
          ]),
        )
    )
      .map((row) => row.id)
      .sort(),
  ).toEqual(["foreign", "live", "malformed", "other-workspace"]);
  expect(
    (
      await db
        .select({ id: schema.featureShares.id })
        .from(schema.featureShares)
    ).map((row) => row.id),
  ).toEqual(["live-share"]);
  expect((await cleanup.run({ dryRun: false }))._receipt.changed).toBe(false);
});
