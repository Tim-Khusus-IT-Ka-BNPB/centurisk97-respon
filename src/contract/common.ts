import { z } from "zod";
import { DRAFT_STATES } from "../domain/draftStates";
import { HAZARD_TYPE_IDS } from "../domain/hazards";

export const zoneSchema = z.enum(["WIB", "WITA", "WIT"]);

// Every time travels as a UTC instant plus the zone label it is shown in.
export const timeSchema = z.object({ utc: z.iso.datetime(), zone: zoneSchema });

// Values that fill {param} placeholders of a copy key.
export const paramsSchema = z.record(z.string(), z.union([z.string(), z.number()]));

export const copyKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+$/);

export const draftStateSchema = z.enum(DRAFT_STATES as [string, ...string[]]);

export const hazardTypeSchema = z.enum(HAZARD_TYPE_IDS as [string, ...string[]]);

export const fieldStateSchema = z.enum(["value", "none", "notYetKnown", "confirmedUnknown", "notAsked"]);

export const valueOriginSchema = z.enum(["boxEntry", "tappedOption", "quote", "system"]);

export const reporterRoleSchema = z.enum(["citizen", "claimedOfficer"]);
