import { z } from "zod";
import { DESK_HAS } from "../domain/deskQueue";
import { summaryGroupSchema } from "./card";
import { hazardTypeSchema, reporterRoleSchema, timeSchema } from "./common";
import { eventTimeSchema, ticketStatusSchema } from "./tracking";

// The signed-in staff account as the desk names it.
const accountSchema = z.object({ label: z.string() });

const placeSchema = z.object({ villageName: z.string(), districtName: z.string(), regencyName: z.string() });

// One sent report in the queue. The reporter's number never travels in the queue.
const queueItemSchema = z.object({
  ticketNumber: z.string(),
  status: ticketStatusSchema,
  hazardType: hazardTypeSchema,
  hazardSubtype: z.string(),
  place: placeSchema,
  eventTime: eventTimeSchema,
  sentAt: timeSchema,
  completePercent: z.number().int().min(0).max(100),
  photoCount: z.number().int().nonnegative(),
  reporter: z.object({ name: z.string(), role: reporterRoleSchema }),
  numberUnverified: z.boolean(),
  // The report's own figures: a count, 0 for an explicit none, null when not known.
  impact: z.object({
    dead: z.number().int().nonnegative().nullable(),
    missing: z.number().int().nonnegative().nullable(),
    injured: z.number().int().nonnegative().nullable(),
    displaced: z.number().int().nonnegative().nullable(),
    houses: z.object({ count: z.number().int().nonnegative(), partial: z.boolean() }).nullable(),
  }),
});

export const deskQueueSchema = z.object({
  account: accountSchema,
  items: z.array(queueItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageCount: z.number().int().nonnegative(),
});

export type DeskQueue = z.infer<typeof deskQueueSchema>;

// How many reports each status queue, hazard chip and holding (victims, photos...) would show
// under the other filters.
export const deskSummarySchema = z.object({
  account: accountSchema,
  total: z.number().int().nonnegative(),
  byStatus: z.record(ticketStatusSchema, z.number().int().nonnegative()),
  byHazard: z.partialRecord(hazardTypeSchema, z.number().int().nonnegative()),
  byHas: z.record(z.enum(DESK_HAS), z.number().int().nonnegative()),
});

export type DeskSummary = z.infer<typeof deskSummarySchema>;

// A summary row with the reporter's own words when the value was read from them.
const deskGroupSchema = summaryGroupSchema.extend({
  rows: z.array(summaryGroupSchema.shape.rows.element.extend({ quote: z.string().nullable() })),
});

// A reporter's photo on the desk, with how its place is known (the reporter flow's badges).
const deskPhotoSchema = z.object({
  photoId: z.string(),
  ticketNumber: z.string(),
  badge: z.enum(["deviceGps", "photoData", "none"]),
  far: z.boolean(),
  takenAt: timeSchema,
  receivedAt: timeSchema,
});

export const deskMapSchema = z.object({
  account: accountSchema,
  points: z.array(
    z.object({
      ticketNumber: z.string(),
      status: ticketStatusSchema,
      hazardType: hazardTypeSchema,
      villageName: z.string(),
      // A village picked by search sits at the village's centre, never at a made-up point.
      precision: z.enum(["gpsPoint", "estimate", "villageLevel"]),
      lat: z.number(),
      lon: z.number(),
    }),
  ),
  // More reports match than the map draws; the newest are drawn.
  cut: z.boolean(),
});

export type DeskMap = z.infer<typeof deskMapSchema>;

export const deskGallerySchema = z.object({
  account: accountSchema,
  photos: z.array(deskPhotoSchema),
  cut: z.boolean(),
});

export type DeskGallery = z.infer<typeof deskGallerySchema>;

export const deskReportSchema = queueItemSchema.extend({
  account: accountSchema,
  reporter: z.object({
    name: z.string(),
    role: reporterRoleSchema,
    number: z.string(),
    officerRegency: z.string().nullable(),
    officerPosition: z.string().nullable(),
  }),
  groups: z.array(deskGroupSchema),
  history: z.array(
    z.object({ status: ticketStatusSchema, at: timeSchema, actor: z.string().nullable(), note: z.string().nullable() }),
  ),
  reporterWords: z.array(z.object({ text: z.string(), at: timeSchema })),
  photos: z.array(deskPhotoSchema),
});

export type DeskReport = z.infer<typeof deskReportSchema>;
