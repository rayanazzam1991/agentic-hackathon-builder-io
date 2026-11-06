import { useParams } from "react-router";

import { FeatureWorkspace } from "@/features/coordinator/FeatureWorkspace";
export default function FeatureDetailRoute() {
  const { id } = useParams();
  return <FeatureWorkspace {...(id ? { id } : {})} />;
}
