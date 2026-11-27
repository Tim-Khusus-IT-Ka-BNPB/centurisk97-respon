import { z } from "zod";
import { hazardTypeSchema, timeSchema } from "./common";
import { impactSchema } from "./desk";
import { eventTimeSchema } from "./tracking";

// The public feed (K59, D84 to D86). Strict objects: this is the allow-list of every value that
// may reach a public page, and a test fails on any other. No name, number, ticket, the reporter's
// own text or point, RT, RW or coordinates of the report: a place is its village, a point the
// village's centre.
const feedEntrySchema = z.strictObject({
  // Stands for the entry; made from a report id, so it names no ticket.
  id: z.string(),
  hazardType: hazardTypeSchema,
  hazardSubtype: z.string().nullable(),
  status: z.enum(["in_handling", "closed"]),
  place: z.strictObject({
    villageName: z.string(),
    districtName: z.string(),
    regencyName: z.string(),
    provinceName: z.string(),
  }),
  centre: z.strictObject({ lat: z.number(), lon: z.number() }).nullable(),
  eventTime: eventTimeSchema.nullable(),
  sentAt: timeSchema,
  // The newest report's own figures: a cluster's are never added up (D28).
  impact: impactSchema,
  // How many people reported this one event, from two.
  reporters: z.number().int().min(2).nullable(),
  // Photos of the work an officer marked public.
  proofs: z.array(z.uuid()).max(4),
});

export const feedSchema = z.strictObject({ entries: z.array(feedEntrySchema) });

export type FeedEntry = z.infer<typeof feedEntrySchema>;
export type Feed = z.infer<typeof feedSchema>;

// The feed's Peringatan view (upstream DP-11): the regencies the three-day outlook puts at Waspada or
// above, and the volcanoes at Siaga or Awas. Null where its file is missing or broken: cannot know.
export const watchSchema = z.strictObject({
  forecast: z
    .strictObject({
      madeAt: z.string(),
      regencies: z.array(
        z.strictObject({
          regencyCode: z.string().regex(/^\d{2}\.\d{2}$/),
          regencyName: z.string(),
          provinceName: z.string(),
          level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
          threats: z.array(z.string()),
        }),
      ),
    })
    .nullable(),
  volcanoes: z
    .strictObject({
      source: z.string(),
      madeAt: z.string(),
      counts: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
      raised: z.array(
        z.strictObject({
          name: z.string(),
          province: z.string(),
          level: z.union([z.literal(3), z.literal(4)]),
          radiusKm: z.number().nullable(),
          report: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
});

export type Watch = z.infer<typeof watchSchema>;

// The events of BNPB's daily report on the Alun-alun (upstream kabar-alun, row 26): each with the
// report's status and figures, and a few headlines from the news. The day is null when the file is
// missing or broken: cannot know.
export const officialSchema = z.strictObject({
  day: z.string().nullable(),
  events: z.array(
    z.strictObject({
      id: z.string(),
      hazardType: hazardTypeSchema,
      regencyName: z.string(),
      provinceCode: z.string(),
      // Null where our place data has no province by that code.
      provinceName: z.string().nullable(),
      point: z.strictObject({ lat: z.number(), lon: z.number() }).nullable(),
      status: z.enum(["berjalan", "belum", "selesai"]),
      startedOn: z.string(),
      lastReportOn: z.string(),
      families: z.number().int().nullable(),
      displaced: z.number().int().nullable(),
      houses: z.number().int().nullable(),
      news: z.array(z.strictObject({ title: z.string(), outlet: z.string(), date: z.string(), url: z.string() })),
      moreNews: z.number().int().nonnegative(),
    }),
  ),
});

export type Official = z.infer<typeof officialSchema>;
