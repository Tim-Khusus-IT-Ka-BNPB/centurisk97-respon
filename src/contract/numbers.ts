import { z } from "zod";
import { FACILITY_KINDS } from "../domain/facilities";
import { timeSchema } from "./common";

// The desk page where BNPB keeps the BPBD numbers and the facility numbers.

const contactNumberSchema = z.object({
  nomor: z.string(),
  jenis: z.string(),
  url: z.string().nullable(),
  lama: z.boolean(),
});

const facilitySchema = z.object({
  kind: z.enum(FACILITY_KINDS),
  name: z.string(),
  phone: z.string(),
  lat: z.number(),
  lon: z.number(),
});

// The file's latest changes, newest first: one made on the desk names who made it, the entry it
// touched (an area's name, or a facility's) and that entry before and after; an import replaced it all.
const changesOf = <T extends z.ZodType>(entry: T) =>
  z.array(
    z.union([
      z.object({
        id: z.number().int(),
        at: timeSchema,
        change: z.enum(["added", "changed", "removed"]),
        by: z.string(),
        entry: z.string(),
        before: entry.nullable(),
        after: entry.nullable(),
      }),
      z.object({ id: z.number().int(), at: timeSchema, change: z.literal("imported") }),
    ]),
  );

// One page of the list, and the checksum of the file it was read from, which every edit sends back.
const page = {
  checksum: z.string().nullable(),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pages: z.number().int().positive(),
};

const indexSchema = z.number().int().nonnegative();

export const deskBpbdNumbersSchema = z.object({
  ...page,
  areas: z.array(
    z.object({
      // "11" for a province, "1101" for a regency.
      code: z.string(),
      name: z.string(),
      provinceName: z.string(),
      level: z.enum(["province", "regency"]),
      numbers: z.array(contactNumberSchema.extend({ index: indexSchema })),
    }),
  ),
  changes: changesOf(contactNumberSchema),
});

export type DeskBpbdNumbers = z.infer<typeof deskBpbdNumbersSchema>;

export const deskFacilityNumbersSchema = z.object({
  ...page,
  facilities: z.array(facilitySchema.extend({ index: indexSchema })),
  changes: changesOf(facilitySchema),
});

export type DeskFacilityNumbers = z.infer<typeof deskFacilityNumbersSchema>;

const areaCodeSchema = z.string().regex(/^\d{2}(\d{2})?$/);

const contactInputSchema = z.object({
  nomor: z.string().max(60),
  jenis: z.string().max(40),
  url: z.string().max(400),
  lama: z.boolean(),
});

export const bpbdEditSchema = z.object({
  checksum: z.string().nullable(),
  edit: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("add"), code: areaCodeSchema, number: contactInputSchema }),
    z.object({ kind: z.literal("change"), code: areaCodeSchema, index: indexSchema, number: contactInputSchema }),
    z.object({ kind: z.literal("remove"), code: areaCodeSchema, index: indexSchema }),
  ]),
});

const facilityInputSchema = z.object({
  kind: z.string().max(20),
  name: z.string().max(300),
  phone: z.string().max(60),
  lat: z.string().max(30),
  lon: z.string().max(30),
});

export const facilityEditSchema = z.object({
  checksum: z.string().nullable(),
  edit: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("add"), facility: facilityInputSchema }),
    z.object({ kind: z.literal("change"), index: indexSchema, facility: facilityInputSchema }),
    z.object({ kind: z.literal("remove"), index: indexSchema }),
  ]),
});

export const numbersSavedSchema = z.object({ checksum: z.string() });
