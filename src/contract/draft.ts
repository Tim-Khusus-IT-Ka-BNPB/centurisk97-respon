import { z } from "zod";
import { cardSchema } from "./card";
import {
  copyKeySchema,
  draftStateSchema,
  hazardTypeSchema,
  paramsSchema,
  reporterRoleSchema,
  timeSchema,
} from "./common";
import { ownReportSchema } from "./tracking";

const transcriptEntrySchema = z.discriminatedUnion("speaker", [
  // The reporter's own words come back masked, for example "[nama pelapor]".
  z.object({ speaker: z.literal("reporter"), textMasked: z.string(), at: timeSchema }),
  // Assistant lines are copy keys with params, never sentences.
  z.object({
    speaker: z.literal("assistant"),
    cardKind: z.string().nullable(),
    copyKey: copyKeySchema,
    // The question the line asked; the history shows it in place of a guided step's progress heading.
    promptKey: copyKeySchema.nullable().optional(),
    params: paramsSchema,
    at: timeSchema,
  }),
]);

const noticeSchema = z.object({
  kind: z.enum(["lifeLine", "refusal", "limit", "danger", "resumed"]),
  copyKey: copyKeySchema,
  params: paramsSchema,
  retryAt: timeSchema.nullable(),
});

export const draftBodySchema = z.object({
  draftId: z.uuid(),
  revision: z.number().int().nonnegative(),
  state: draftStateSchema,
  card: cardSchema,
  transcript: z.array(transcriptEntrySchema),
  notices: z.array(noticeSchema),
  completePercent: z.number().int().min(0).max(100),
  keptUntil: timeSchema,
  canGoBack: z.boolean(),
  freeTextAllowed: z.boolean(),
  // The sent report this draft adds news to; null for a report of its own.
  followUpOf: z.string().nullable(),
  // Echo of the request's turn key.
  turnKey: z.uuid().nullable(),
});

export type DraftBody = z.infer<typeof draftBodySchema>;

export const meResponseSchema = z.object({
  knownReporters: z.array(
    z.object({
      profileId: z.uuid(),
      name: z.string(),
      maskedNumber: z.string(),
      role: reporterRoleSchema,
      lastUsedAt: timeSchema,
      openDraft: z
        .object({
          draftId: z.uuid(),
          hazardType: hazardTypeSchema.nullable(),
          lastActedAt: timeSchema,
          // The sent report it adds news to; null for a report of its own.
          followUpOf: z.string().nullable(),
        })
        .nullable(),
    }),
  ),
  // "Laporan saya": the sent reports of this device's numbers, or of the session's number.
  reports: z.array(ownReportSchema),
  privacyVersion: z.number().int().positive(),
  // A main-site session, if any. It never carries the number.
  session: z.object({ kind: z.enum(["reporter", "staff"]) }).nullable(),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

// The answer to a send: the ticket and when it was sent.
export const sentResponseSchema = z.object({ ticketNumber: z.string(), sentAt: timeSchema });
