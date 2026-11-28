import { z } from "zod";
import { DESK_HAS } from "../domain/deskQueue";
import { VICTIM_ANSWERS } from "../domain/emergency";
import { CHECK_RESULTS } from "../domain/fieldCheck";
import { GPS_DOUBTS } from "../domain/gpsDoubts";
import { photoBadgeSchema, summaryGroupSchema } from "./card";
import { deskCommentsSchema } from "./comments";
import { hazardTypeSchema, reporterRoleSchema, timeSchema } from "./common";
import { reportVersionSchema } from "./ownReport";
import { contactSchema, eventTimeSchema, ticketStatusSchema } from "./tracking";

// A report's own figures: a count, 0 for an explicit none, null when not known.
export const impactSchema = z.strictObject({
  dead: z.number().int().nonnegative().nullable(),
  missing: z.number().int().nonnegative().nullable(),
  injured: z.number().int().nonnegative().nullable(),
  displaced: z.number().int().nonnegative().nullable(),
  houses: z.strictObject({ count: z.number().int().nonnegative(), partial: z.boolean() }).nullable(),
});

// The signed-in staff account as the desk names it.
const accountSchema = z.object({ label: z.string() });

const placeSchema = z.object({ villageName: z.string(), districtName: z.string(), regencyName: z.string() });

const emergencySchema = z.object({ kind: z.enum(["chat", "oneTap"]), victims: z.enum(VICTIM_ANSWERS) });

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
  // The name is null for an account that must ask for identity on the report.
  reporter: z.object({ name: z.string().nullable(), role: reporterRoleSchema }),
  numberUnverified: z.boolean(),
  // Which door it came through; a chat proves its number.
  door: z.enum(["web", "chat"]),
  // Raised as an emergency, and what the reporter said of victims. One tap's kind is not known.
  emergency: emergencySchema.nullable(),
  // Kept on the reporter's phone with no signal (LR-09): when the phone saved it, null when its clock
  // could not be believed, and whether it came more than 2 hours late, so it does not ring.
  offline: z.object({ savedAt: timeSchema.nullable(), late: z.boolean() }).nullable(),
  // The officer who has it in hand, as the desk names them. Never on the tracking page.
  taker: z.string().nullable(),
  // The reporter added news that no officer has acted on yet.
  news: z.boolean(),
  // Still open after a week in one status (Q40).
  overdue: z.boolean(),
  impact: impactSchema,
  // Reports of the same hazard close in place and time from two numbers or more (A9): its tickets,
  // oldest first, this one among them. Never called verified, and its figures are never added up.
  cluster: z
    .object({
      tickets: z.array(z.string()).min(2),
      reporters: z.number().int().min(2),
      strong: z.boolean(),
      // Joined only because its reports are of one village within a day (LK-01).
      sameVillage: z.boolean(),
    })
    .nullable(),
});

export const deskQueueSchema = z.object({
  account: accountSchema,
  items: z.array(queueItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageCount: z.number().int().nonnegative(),
});

export type DeskQueue = z.infer<typeof deskQueueSchema>;

// An emergency nobody has opened yet.
const deskEmergencySchema = emergencySchema.extend({
  ticketNumber: z.string(),
  hazardType: hazardTypeSchema,
  villageName: z.string(),
  regencyName: z.string(),
  sentAt: timeSchema,
});

export type DeskEmergency = z.infer<typeof deskEmergencySchema>;

export const deskEmergenciesSchema = z.object({ emergencies: z.array(deskEmergencySchema) });

export type DeskEmergencies = z.infer<typeof deskEmergenciesSchema>;

// How many reports each status queue, hazard chip and holding (victims, photos...) would show
// under the other filters.
export const deskSummarySchema = z.object({
  account: accountSchema,
  total: z.number().int().nonnegative(),
  byStatus: z.record(ticketStatusSchema, z.number().int().nonnegative()),
  byHazard: z.partialRecord(hazardTypeSchema, z.number().int().nonnegative()),
  byHas: z.record(z.enum(DESK_HAS), z.number().int().nonnegative()),
  emergencies: z.array(deskEmergencySchema),
  // This account may read how fast each agency answers.
  mayReadResponse: z.boolean(),
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
  badge: photoBadgeSchema,
  far: z.boolean(),
  takenAt: timeSchema,
  receivedAt: timeSchema,
  // Why its GPS may not be where the phone was (D11): marked, never refused.
  doubts: z.array(z.enum(GPS_DOUBTS)),
});

const mapPointSchema = z.object({
  ticketNumber: z.string(),
  status: ticketStatusSchema,
  hazardType: hazardTypeSchema,
  villageName: z.string(),
  // A village picked by search sits at the village's centre, never at a made-up point.
  precision: z.enum(["gpsPoint", "estimate", "villageLevel", "chatLocation"]),
  emergency: z.boolean(),
  lat: z.number(),
  lon: z.number(),
});

export const deskMapSchema = z.object({
  account: accountSchema,
  points: z.array(mapPointSchema),
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

// Who reported, as staff see it.
export const deskIdentitySchema = z.object({
  name: z.string(),
  number: z.string(),
  officerRegency: z.string().nullable(),
  officerPosition: z.string().nullable(),
});

export type DeskIdentity = z.infer<typeof deskIdentitySchema>;

// The region's BPBD officers as BNPB sees them on a report: numbers masked until opened.
const deskOfficerSchema = z.object({
  profileId: z.string(),
  name: z.string(),
  position: z.string(),
  agency: z.string(),
  level: z.enum(["regency", "province"]),
  masked: z.string(),
});

export const deskReportSchema = queueItemSchema.extend({
  account: accountSchema,
  // Videos of the scene, in the order they came; each played from its own address.
  videos: z.array(
    z.object({
      id: z.uuid(),
      seconds: z.number().int(),
      container: z.string(),
      // When and where the file says it was made; null when it says nothing believable.
      madeAt: timeSchema.nullable(),
      point: z.object({ lat: z.number(), lon: z.number() }).nullable(),
    }),
  ),
  // The event its reporter confirmed it is of, with its reports; this account may take it out.
  event: z.object({ code: z.string(), tickets: z.array(z.string()).min(1), mayRelease: z.boolean() }).nullable(),
  // Null when the account must ask for it, each time logged.
  reporter: z.object({ role: reporterRoleSchema, identity: deskIdentitySchema.nullable() }),
  // BNPB only: who at the BPBD to call, and the BPBD's own number when no officer of the regency
  // is there; null for an account that may not.
  officers: z.object({ items: z.array(deskOfficerSchema), official: contactSchema.nullable() }).nullable(),
  // The public today page's five conditions for this report, and whether it shows there now; null
  // while the page is shut.
  today: z
    .object({
      conditions: z.object({
        valid: z.boolean(),
        bpbd: z.boolean(),
        ticket: z.boolean(),
        version: z.boolean(),
        pull: z.boolean(),
      }),
      shown: z.boolean(),
    })
    .nullable(),
  // The comments on the Alun-alun card this report shows on; null when there are none.
  comments: deskCommentsSchema.nullable(),
  // The BPBD's follow-up file of this report (M09): its id and state, null when none is open; and
  // whether this account may open one, as the BPBD of the report's regency.
  caseFile: z
    .object({
      file: z.object({ id: z.string(), status: z.enum(["open", "proposed", "done", "doneNoted"]) }).nullable(),
      mayOpen: z.boolean(),
    })
    .nullable(),
  // Where it is on the map; null where its village has no outline to place it in.
  point: mapPointSchema.nullable(),
  groups: z.array(deskGroupSchema),
  history: z.array(
    z.object({
      status: ticketStatusSchema,
      at: timeSchema,
      // The officer who did it; null for the system, and for the reporter's own news.
      actor: z.string().nullable(),
      note: z.string().nullable(),
      // The regency whose desk it went to.
      forwardedTo: z.string().nullable(),
      // Work told in the history: what a check found and put right, or what was done.
      event: z.enum(["fieldCheck", "actions", "take", "followUp", "released", "commentFigure"]).nullable(),
      detail: z
        .object({
          result: z.enum(CHECK_RESULTS).optional(),
          changes: z
            .array(z.object({ fieldId: z.string(), from: z.number().nullable(), to: z.number() }))
            .readonly()
            .optional(),
          actions: z.array(z.string()).readonly().optional(),
          taker: z.string().optional(),
          // The event a report was released from.
          code: z.string().optional(),
          version: z.number().int().optional(),
        })
        .nullable(),
    }),
  ),
  reporterWords: z.array(z.object({ text: z.string(), at: timeSchema })),
  // Where the ticket may go from here, and what the note must hold for each.
  nextStatuses: z.array(
    z.object({ status: ticketStatusSchema, note: z.enum(["optional", "required", "reason", "closing"]) }),
  ),
  // Sent back with a change, so a change made on an old reading is refused.
  revision: z.number().int().nonnegative(),
  // This officer may take the report in hand.
  mayTake: z.boolean(),
  // The figures a field check may put right, with what each holds.
  revisable: z.array(
    z.object({ fieldId: z.string(), unit: z.string(), max: z.number(), count: z.number().nullable() }),
  ),
  offeredActions: z.array(z.object({ code: z.string(), label: z.string() })),
  actions: z.array(z.object({ label: z.string(), at: timeSchema, actor: z.string() })),
  proofs: z.array(
    // public: shown on the public feed while the report is handled (D88).
    z.object({ proofId: z.string(), hasPoint: z.boolean(), at: timeSchema, actor: z.string(), public: z.boolean() }),
  ),
  replies: z.array(
    z.object({
      text: z.string(),
      at: timeSchema,
      actor: z.string(),
    }),
  ),
  photos: z.array(deskPhotoSchema),
  // The reporter stopped the news: a reply stays readable on their page but is not marked new.
  newsStopped: z.boolean(),
  // Newest first, each with its document.
  versions: z.array(reportVersionSchema),
});

export type DeskReport = z.infer<typeof deskReportSchema>;

const spreadSchema = z.object({
  count: z.number().int().positive(),
  median: z.number().int().nonnegative(),
  p90: z.number().int().nonnegative(),
});

// How fast each agency answered the month's reports, in whole minutes; figures are null under 5
// reports. Ordered by name, never ranked.
export const deskResponseSchema = z.object({
  account: accountSchema,
  month: z.string(),
  agencies: z.array(
    z.object({
      regencyCode: z.string(),
      regencyName: z.string(),
      reports: z.number().int().positive(),
      figures: z
        .object({
          seen: spreadSchema.nullable(),
          taken: spreadSchema.nullable(),
          notSeen: z.number().int().nonnegative(),
          notTaken: z.number().int().nonnegative(),
          dropped: z.number().int().nonnegative(),
        })
        .nullable(),
    }),
  ),
});

export type DeskResponse = z.infer<typeof deskResponseSchema>;
