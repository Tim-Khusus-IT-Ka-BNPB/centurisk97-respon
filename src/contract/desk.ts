import { z } from "zod";
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
});

export const deskQueueSchema = z.object({
  account: accountSchema,
  items: z.array(queueItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageCount: z.number().int().nonnegative(),
});

export type DeskQueue = z.infer<typeof deskQueueSchema>;

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
