import { PGlite } from "@electric-sql/pglite";
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
} from "@agent-native/core/private-blob";
import type { PrivateBlobHandle } from "@agent-native/core/private-blob";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import * as schema from "../db/schema";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  feature: undefined as unknown,
}));
vi.mock("../db", async () => ({
  schema: await import("../db/schema"),
  getDb: () => state.db,
}));
vi.mock("./store", () => ({
  requireActor: () => "owner@example.test",
  getFeature: async () => state.feature,
}));
import removeFeature from "../../actions/delete-feature";
import { storeStitchScreenshot } from "./screenshots";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const blobs = new Map<string, Uint8Array>();
const providerId = "delete-feature-test";
let failDelete = false;
const provider = {
  id: providerId,
  name: "Test",
  isConfigured: () => true,
  put: async (input: { data: Uint8Array; mimeType?: string }): Promise<PrivateBlobHandle> => {
    const id = `blob-${blobs.size + 1}`;
    blobs.set(id, new Uint8Array(input.data));
    return {
      id,
      provider: providerId,
      opaque: true,
      encrypted: false,
      mimeType: input.mimeType ?? "application/octet-stream",
      size: input.data.byteLength,
    };
  },
  read: async (handle: PrivateBlobHandle) => {
    const data = blobs.get(handle.id);
    if (!data) throw new Error("missing");
    return { data, mimeType: handle.mimeType ?? "application/octet-stream", handle };
  },
  delete: async (handle: PrivateBlobHandle) => {
    if (failDelete)
      return { deleted: false, provider: providerId, reason: "denied" };
    blobs.delete(handle.id);
    return { deleted: true, provider: providerId };
  },
};

let client: PGlite;
let featureId: string;
const id = "11111111-1111-4111-8111-111111111111";
const run = (args: object, caller = "frontend") =>
  (removeFeature.run as (a: object, c: object) => Promise<any>)(args, {
    caller,
  });

beforeAll(() => registerPrivateBlobProvider(provider));
afterAll(() => unregisterPrivateBlobProvider(providerId));

beforeEach(async () => {
  blobs.clear();
  failDelete = false;
  featureId = id;
  client = new PGlite();
  await client.exec(
    `CREATE TABLE coordination_features (id text primary key,title text not null,status text not null,feature_status text not null default 'not_started',revision integer not null,data jsonb not null,owner_email text not null,org_id text,visibility text not null);
     CREATE TABLE coordination_feature_shares (id text primary key,resource_id text not null,principal_type text,principal_id text,role text,created_by text,created_at text,notified_at text);`,
  );
  state.db = drizzle(client, { schema });
  const screenshot = await storeStitchScreenshot({
    featureId,
    projectId: "123",
    screenId: "screen1",
    title: "Eligible",
    capturedAt: "2026-11-08T10:00:00.000Z",
    bytes: png,
    ownerEmail: "owner@example.test",
  });
  const data = {
    sample: false,
    sources: [
      {
        kind: "stitch",
        version: "v1",
        excerpt: "text",
        capturedAt: "2026-11-08T10:00:00.000Z",
        screenshot,
      },
    ],
    question: {},
    activity: [],
  };
  await (state.db as ReturnType<typeof drizzle<typeof schema>>)
    .insert(schema.features)
    .values({
      id,
      title: "Review",
      status: "open",
      revision: 1,
      data: data as never,
      ownerEmail: "owner@example.test",
      orgId: "workspace-test",
      visibility: "private",
    });
  await client.exec(
    `INSERT INTO coordination_feature_shares (id,resource_id) VALUES ('s1','${id}')`,
  );
  state.feature = {
    id,
    title: "Review",
    revision: 1,
    status: "open",
    featureStatus: "not_started",
    data,
    ownerEmail: "owner@example.test",
    canEdit: true,
    canApprove: true,
  };
});

const rows = async () =>
  (state.db as ReturnType<typeof drizzle<typeof schema>>)
    .select()
    .from(schema.features);

it("deletes one owned review, its shares and its screenshot", async () => {
  expect(await rows()).toHaveLength(1);
  const result = await run({ id });
  expect(result.deleted).toBe(true);
  expect(result._receipt.verified).toBe(true);
  expect(await rows()).toHaveLength(0);
  expect(blobs.size).toBe(0);
});

it("deletes nothing when screenshot cleanup fails", async () => {
  failDelete = true;
  await expect(run({ id })).rejects.toThrow("could not be removed");
  expect(await rows()).toHaveLength(1);
  expect(blobs.size).toBe(1);
});

it("refuses reviews owned by someone else", async () => {
  state.feature = { ...(state.feature as object), ownerEmail: "other@example.test" };
  await expect(run({ id })).rejects.toThrow("Only the review owner");
  expect(await rows()).toHaveLength(1);
  expect(blobs.size).toBe(1);
});

it("refuses non-frontend callers", async () => {
  await expect(run({ id }, "tool")).rejects.toThrow("signed-in app UI");
  expect(await rows()).toHaveLength(1);
});
