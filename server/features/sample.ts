import {
  FeatureParticipant,
  FeatureSource,
  type FeatureData,
} from "@shared/features/types";

// Synthetic business content only. Nothing here was read from a company tool.
export function createSampleData(actor: string): FeatureData {
  return {
    sample: true,
    sources: [
      {
        kind: FeatureSource.CONFLUENCE,
        version: "Sample v1 · agreed baseline",
        excerpt:
          "Customers may cancel an order within 24 hours of placing it. After that, cancellation is unavailable.",
      },
      {
        kind: FeatureSource.JIRA,
        version: "Sample STORY-101 · revision 2",
        excerpt:
          "Acceptance criteria: show Cancel order for the first 24 hours. Hide it when the cancellation window has expired. Show a confirmation before cancellation.",
      },
      {
        kind: FeatureSource.FIGMA,
        version: "Sample frame · revision 3",
        excerpt:
          "Order details helper text: You can cancel this order within 48 hours. The Cancel order button is visible in the 36-hour example.",
      },
    ],
    question: {
      text: "Should the cancellation window be 24 or 48 hours? Jira and the agreed specification say 24 hours, while the updated design shows 48 hours.",
      owner: FeatureParticipant.PO,
      reply: null,
      replyBy: null,
      proposal: null,
      rationale: null,
      approvedBy: null,
      approvedAt: null,
    },
    activity: [
      {
        id: crypto.randomUUID(),
        event: "Sample created",
        actor,
        at: new Date().toISOString(),
        detail:
          "Synthetic source snapshots and a known mismatch were loaded. No integrations were contacted.",
      },
    ],
  };
}
