import { describe, expect, it } from "vitest";

import { createSampleData } from "../../server/features/sample";
import { DiscordDeliveryStatus } from "./discord";
import { getFeatureQuestions } from "./questions";
import {
  FeatureDataSchema,
  FeatureParticipant,
  PrimaryQuestionId,
  QuestionAskApproval,
  QuestionAskProvenance,
  QuestionStatus,
} from "./types";

const ids = {
  guild: "123456789012345678",
  channel: "223456789012345678",
  bot: "323456789012345678",
  message: "423456789012345678",
};
const withDelivery = (status: DiscordDeliveryStatus) => {
  const data = createSampleData("o@example.test");
  data.discord = {
    guildId: ids.guild,
    channelId: ids.channel,
    channelName: "review",
    botId: ids.bot,
    delivery: {
      status,
      nonce: "n",
      content: "Q?",
      requestedAt: null,
      messageId: status === DiscordDeliveryStatus.SENT ? ids.message : null,
    },
    replies: [],
    checkedAt: null,
    partial: false,
  };
  return data;
};

describe("feature question collection", () => {
  it("loads legacy data unchanged and projects it as the primary question", () => {
    const legacy = withDelivery(DiscordDeliveryStatus.SENT);
    legacy.question.reply = "Use 24";
    legacy.question.replyBy = "PO";
    const parsed = FeatureDataSchema.parse(structuredClone(legacy));
    expect(parsed).toEqual(legacy);
    expect(parsed.questions).toBeUndefined();
    const all = getFeatureQuestions(parsed);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: PrimaryQuestionId,
      text: legacy.question.text,
      reply: "Use 24",
      status: QuestionStatus.ANSWERED,
      askApproval: {
        status: QuestionAskApproval.APPROVED,
        by: null,
        provenance: QuestionAskProvenance.LEGACY_SEND_CONFIRMATION,
      },
    });
    expect(all[0]?.discord?.delivery?.messageId).toBe(ids.message);
  });
  it("treats a legacy draft as not yet approved to ask", () => {
    const [primary] = getFeatureQuestions(
      withDelivery(DiscordDeliveryStatus.DRAFT),
    );
    expect(primary?.askApproval.status).toBe(QuestionAskApproval.PENDING);
    expect(primary?.askApproval.provenance).toBeUndefined();
  });
  it("keeps legacy fields authoritative for the primary question", () => {
    const data = createSampleData("o@example.test");
    data.question.owner = FeatureParticipant.BE;
    data.questions = [];
    const [primary] = getFeatureQuestions(data, QuestionStatus.PROPOSED);
    expect(primary).toMatchObject({
      owner: FeatureParticipant.BE,
      status: QuestionStatus.PROPOSED,
    });
  });
  it("reserves the primary id and requires unique ids", () => {
    const data = createSampleData("o@example.test");
    const base = {
      ...getFeatureQuestions(data)[0]!,
      owner: null,
    };
    expect(
      FeatureDataSchema.safeParse({
        ...data,
        questions: [{ ...base, id: PrimaryQuestionId }],
      }).success,
    ).toBe(false);
    expect(
      FeatureDataSchema.safeParse({
        ...data,
        questions: [
          { ...base, id: "a" },
          { ...base, id: "a" },
        ],
      }).success,
    ).toBe(false);
  });
});
