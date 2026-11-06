import { runMigrations } from "@agent-native/core/db";

import "../db/index";

// Add future migrations; never edit this named migration after it is applied.
export default runMigrations(
  [
    {
      version: 1,
      name: "feature-coordination-review-cycle",
      sql: `
CREATE TABLE IF NOT EXISTS coordination_features (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, data JSONB NOT NULL,
  owner_email TEXT NOT NULL, org_id TEXT, visibility TEXT NOT NULL DEFAULT 'private'
);
CREATE INDEX IF NOT EXISTS coordination_features_owner_idx ON coordination_features(owner_email);
CREATE TABLE IF NOT EXISTS coordination_feature_shares (
  id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (now()::text), notified_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS coordination_feature_shares_principal_idx
  ON coordination_feature_shares(resource_id, principal_type, principal_id);
`,
    },
  ],
  { table: "_coordination_schema_migrations" },
);
