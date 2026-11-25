import { localDate } from "./eventTime";
import { DAY_MS } from "./time";

// How long each kind of row is kept, and how much one scheduled step handles at a time.
export const RETENTION = {
  draftLifeMs: DAY_MS,
  turnReplyMs: DAY_MS,
  // Counters go one day after their window ends; the longest window is one day.
  rateCounterMs: 2 * DAY_MS,
  modelUsageDays: 2,
  deviceUnseenMs: 365 * DAY_MS,
  emptiedDraftMs: 30 * DAY_MS,
  gatewayMessageMs: 2 * DAY_MS,
  chatSessionMs: DAY_MS,
  batch: 500,
} as const;

export type SweepCutoffs = {
  // Drafts last acted on before this are expired.
  readonly draftActedBefore: Date;
  readonly turnReplyBefore: Date;
  readonly rateWindowBefore: Date;
  // Model usage of WIB days before this date is removed.
  readonly modelUsageBefore: string;
  readonly deviceSeenBefore: Date;
  readonly draftEndedBefore: Date;
  // Message ids a gateway used before this, and chats quiet since before this, are removed.
  readonly gatewayMessageBefore: Date;
  readonly chatSessionBefore: Date;
};

export function sweepCutoffs(nowMs: number): SweepCutoffs {
  return {
    draftActedBefore: new Date(nowMs - RETENTION.draftLifeMs),
    turnReplyBefore: new Date(nowMs - RETENTION.turnReplyMs),
    rateWindowBefore: new Date(nowMs - RETENTION.rateCounterMs),
    modelUsageBefore: localDate(nowMs - (RETENTION.modelUsageDays - 1) * DAY_MS, "WIB"),
    deviceSeenBefore: new Date(nowMs - RETENTION.deviceUnseenMs),
    draftEndedBefore: new Date(nowMs - RETENTION.emptiedDraftMs),
    gatewayMessageBefore: new Date(nowMs - RETENTION.gatewayMessageMs),
    chatSessionBefore: new Date(nowMs - RETENTION.chatSessionMs),
  };
}
