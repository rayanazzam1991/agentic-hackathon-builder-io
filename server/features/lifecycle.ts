import { defineMachine } from "@agent-native/core/state-machine";
import { QuestionEvent, QuestionStatus } from "@shared/features/types";

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
