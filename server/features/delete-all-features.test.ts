import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, expect, it, vi } from "vitest";

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
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
} from "@agent-native/core/private-blob";
import type { PrivateBlobHandle } from "@agent-native/core/private-blob";

import removeAll from "../../actions/delete-all-features";

const row = (id: string, data = {}) => ({
  id,
  title: id,
  status: "open" as const,
  revision: 1,
  data: data as never,
  visibility: "private" as const,
});
const run = (args: object, caller = "frontend") =>
  (removeAll.run as (a: object, c: object) => Promise<any>)(args, { caller });
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
  const client = new PGlite();
  await client.exec(
    `CREATE TABLE coordination_features (id text primary key,title text not null,status text not null,feature_status text not null default 'not_started',revision integer not null,data jsonb not null,owner_email text not null,org_id text,visibility text not null); CREATE TABLE coordination_feature_shares (id text primary key,resource_id text not null,principal_type text,principal_id text,role text,created_by text,created_at text,notified_at text);`,
  );
  db = drizzle(client, { schema });
  state.db = db;
  await db.insert(schema.features).values([
    {
      ...row("a", { discord: { delivery: { status: "sent" } } }),
      ownerEmail: "owner@example.test",
      orgId: "workspace-test",
    },
    { ...row("b"), ownerEmail: "owner@example.test", orgId: "workspace-test" },
    {
      ...row("foreign"),
      ownerEmail: "other@example.test",
      orgId: "workspace-test",
    },
    {
      ...row("elsewhere"),
      ownerEmail: "owner@example.test",
      orgId: "different",
    },
  ]);
  await client.exec(
    `INSERT INTO coordination_feature_shares (id,resource_id) VALUES ('s1','a'),('s2','foreign')`,
  );
});
const ids = async () =>
  (await db.select().from(schema.features)).map((f) => f.id).sort();

it("previews without writing and reports Discord history", async () => {
  const result = await run({});
  expect(result.reviews.map((r: any) => r.id).sort()).toEqual(["a", "b"]);
  expect(result.reviews.find((r: any) => r.id === "a").hasDiscordHistory).toBe(
    true,
  );
  expect(await ids()).toHaveLength(4);
});

it("deletes only the owner's reviews and their shares", async () => {
  const result = await run({ dryRun: false, expectedCount: 2 });
  expect(result.remaining).toBe(0);
  expect(await ids()).toEqual(["elsewhere", "foreign"]);
  const shares = await db.select().from(schema.featureShares);
  expect(shares.map((s) => s.resourceId)).toEqual(["foreign"]);
});

it("deletes nothing on a count mismatch", async () => {
  await expect(run({ dryRun: false, expectedCount: 1 })).rejects.toThrow();
  await expect(run({ dryRun: false })).rejects.toThrow();
  expect(await ids()).toHaveLength(4);
});

it("removes stored screenshots before bulk deletion", async () => {
  const deleted: string[] = [];
  const providerId = "bulk-delete-test";
  registerPrivateBlobProvider({
    id: providerId,
    name: "Test",
    isConfigured: () => true,
    put: async () => {
      throw new Error("unused");
    },
    read: async (handle: PrivateBlobHandle) => {
      throw new Error("unused");
    },
    delete: async (handle: PrivateBlobHandle) => {
      deleted.push(handle.id);
      return { deleted: true, provider: providerId };
    },
  });
  await db
    .update(schema.features)
    .set({
      data: {
        sources: [
          {
            kind: "stitch",
            version: "v1",
            excerpt: "text",
            screenshot: {
              storage: {
                id: "blob-a",
                provider: providerId,
                encrypted: false,
                mimeType: "image/png",
                size: 10,
              },
              capturedAt: "2026-11-08T10:00:00.000Z",
              label: "Eligible",
              scope: "snapshot",
            },
          },
        ],
      } as never,
    })
    .where(
      and(
        eq(schema.features.id, "a"),
        eq(schema.features.ownerEmail, "owner@example.test"),
      ),
    );
  const result = await run({ dryRun: false, expectedCount: 2 });
  expect(result.remaining).toBe(0);
  expect(deleted).toEqual(["blob-a"]);
  unregisterPrivateBlobProvider(providerId);
});

it("rejects non-frontend callers", async () => {
  await expect(
    run({ dryRun: false, expectedCount: 2 }, "agent"),
  ).rejects.toThrow();
  expect(await ids()).toHaveLength(4);
});
