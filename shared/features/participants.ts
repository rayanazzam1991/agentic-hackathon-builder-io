export const FeatureParticipant = {
  PO: "Product owner",
  FE: "Frontend developer",
  BE: "Backend developer",
  DESIGN: "Designer",
} as const;
export type FeatureParticipant =
  (typeof FeatureParticipant)[keyof typeof FeatureParticipant];
