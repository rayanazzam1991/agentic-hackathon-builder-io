import { defineMachine } from "@agent-native/core/state-machine";
import { FeatureProgress, FeatureProgressEvent, QuestionEvent, QuestionStatus } from "@shared/features/types";

export const featureProgressMachine = defineMachine({
  id: "feature-progress",
  states: Object.values(FeatureProgress),
  initial: FeatureProgress.NOT_STARTED,
  terminal: [],
  transitions: {
    [FeatureProgressEvent.START]: { from: [FeatureProgress.NOT_STARTED], to: FeatureProgress.IN_PROGRESS },
    [FeatureProgressEvent.COMPLETE]: { from: [FeatureProgress.IN_PROGRESS], to: FeatureProgress.DONE },
    [FeatureProgressEvent.REOPEN]: { from: [FeatureProgress.DONE], to: FeatureProgress.IN_PROGRESS },
    [FeatureProgressEvent.RESET]: { from: [FeatureProgress.IN_PROGRESS], to: FeatureProgress.NOT_STARTED },
  },
});

// Approval is terminal in this first slice; changing an approved rule requires
// a new review cycle, which must be implemented explicitly rather than bypassed.
export const questionMachine = defineMachine({
  id: "feature-question",
  states: Object.values(QuestionStatus),
  initial: QuestionStatus.OPEN,
  terminal: [QuestionStatus.APPROVED],
  transitions: {
    [QuestionEvent.ASSIGN]: {
      from: [QuestionStatus.OPEN],
      to: QuestionStatus.OPEN,
    },
    [QuestionEvent.REPLY]: {
      from: [
        QuestionStatus.OPEN,
        QuestionStatus.ANSWERED,
        QuestionStatus.PROPOSED,
      ],
      to: QuestionStatus.ANSWERED,
    },
    [QuestionEvent.PROPOSE]: {
      from: [QuestionStatus.ANSWERED, QuestionStatus.PROPOSED],
      to: QuestionStatus.PROPOSED,
    },
    [QuestionEvent.APPROVE]: {
      from: [QuestionStatus.PROPOSED],
      to: QuestionStatus.APPROVED,
    },
  },
});
