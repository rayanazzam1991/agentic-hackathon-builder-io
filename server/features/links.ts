import { buildDeepLink } from "@agent-native/core/server";
import { FeatureResource } from "@shared/features/types";

export function featureLink({ result }: { result: { id: string } }) {
  return {
    url: buildDeepLink({
      view: "features",
      to: `${FeatureResource.PATH}/${result.id}`,
    }),
    label: "Open feature",
  };
}
export function featureListLink() {
  return {
    url: buildDeepLink({ view: "features", to: FeatureResource.PATH }),
    label: "Open feature reviews",
  };
}
