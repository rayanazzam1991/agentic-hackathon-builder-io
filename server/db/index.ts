import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";
import { FeatureResource } from "@shared/features/types";

import * as schema from "./schema";

export const getDb = createGetDb(schema);
export { schema };
registerShareableResource({
  type: FeatureResource.TYPE,
  displayName: "Feature",
  resourceTable: schema.features,
  sharesTable: schema.featureShares,
  titleColumn: "title",
  getDb,
  getResourcePath: (feature) => `${FeatureResource.PATH}/${feature.id}`,
  agentRead: { actions: ["get-feature"] },
  allowPublic: false,
  requireOrgMemberForUserShares: true,
  supportsGroupShares: true,
});
