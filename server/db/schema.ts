import {
  createSharesTable,
  ownableColumns,
} from "@agent-native/core/db/schema";
import { FeatureProgress, type FeatureData } from "@shared/features/types";
import { index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";

// One aggregate owns this initial review cycle. Revision compare-and-set keeps
// the question, decision and activity trail consistent in a single SQL write.
export const features = pgTable(
  "coordination_features",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    featureStatus: text("feature_status").notNull().default(FeatureProgress.NOT_STARTED),
    revision: integer("revision").notNull().default(1),
    data: jsonb("data").$type<FeatureData>().notNull(),
    ...ownableColumns(),
  },
  (t) => [index("coordination_features_owner_idx").on(t.ownerEmail)],
);
export const featureShares = createSharesTable("coordination_feature_shares");
