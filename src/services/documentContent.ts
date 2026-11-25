import emblemFile from "../adapters/document/emblem.jpg?inline";
import { copy } from "../copy";
import { hazardKey } from "../copy/hazardKey";
import { textFrom } from "../copy/text";
import { clockTime, type Instant, longDate } from "../copy/time";
import { rowParts } from "../copy/values";
import type { Cell, DocumentBlock, Picture, ReportDocument } from "../domain/document";
import type { EmergencyKind, VictimAnswer } from "../domain/emergency";
import type { FieldState, FieldStates, PlaceValue } from "../domain/fieldState";
import { applicableFields, chosenHazardType } from "../domain/fields/applicable";
import { type FieldId, fieldById } from "../domain/fields/catalogue";
import type { ReporterRole } from "../domain/identityForm";
import { jpegSize } from "../domain/jpeg";
import type { Door } from "../domain/ownership";
import type { KeptPhoto } from "../domain/photoChecks";
import { tallyOf } from "../domain/tally";
import { versionChanges } from "../domain/versions";
import { type SummaryRow, summaryGroups, summaryRow } from "./summary";

// A version of a report put into the words of its document. Nothing here names the reporter or
// gives their number: a document leaves the desk (HF4).

const t = textFrom(copy);

export type DocumentPhoto = {
  readonly picture: Picture;
  readonly badge: KeptPhoto["badge"];
  readonly far: boolean;
  readonly takenAt: Instant;
};

export type DocumentSource = {
  readonly ticketNumber: string;
  readonly version: number;
  readonly sentAt: Instant;
  readonly versionAt: Instant;
  readonly states: FieldStates;
  // The version before this one, and who made this one out of it; null for the first.
  readonly change: {
    readonly before: FieldStates;
    readonly madeBy: "reporter" | "officer";
    // The officer's note, for staff only.
    readonly note: string | null;
    readonly newPhotos: number;
  } | null;
  readonly reporterRole: ReporterRole;
  readonly officerRegency: string | null;
  readonly numberUnverified: boolean;
  readonly door: Door;
  readonly emergency: { readonly kind: EmergencyKind; readonly victims: VictimAnswer } | null;
  readonly photos: readonly DocumentPhoto[];
  // Photos that could not be put in: missing from the store, or past what a document may hold.
  readonly photosLeft: number;
  // Staff read the officer's note under a corrected value too.
  readonly forStaff: boolean;
};

const bytesOf = (inline: string) =>
  Uint8Array.from(atob(inline.slice(inline.indexOf(",") + 1)), (character) => character.charCodeAt(0));

export function pictureOf(bytes: Uint8Array): Picture | null {
  const size = jpegSize(bytes);
  return size === null ? null : { bytes, ...size };
}

const EMBLEM = pictureOf(bytesOf(emblemFile)) as Picture;

const list = new Intl.ListFormat("id-ID", { style: "long", type: "conjunction" });
const at = (instant: Instant) =>
  t("stage.reachedAt", { date: longDate(instant), time: clockTime(instant), zone: instant.zone });

const placeOf = (states: FieldStates) => (states.place as { readonly value: PlaceValue }).value;

// A value in the summary's words, or the words of its empty state.
function cellOf(states: FieldStates, fieldId: FieldId): Cell {
  const row = summaryRow(states, fieldById(fieldId));
  if (row === null) return { text: t("state.notYetKnown"), look: "empty" };
  const parts = rowParts(t, row, chosenHazardType(states));
  return parts.value === null
    ? { text: t(`state.${parts.state}`), look: "empty" }
    : { text: parts.value, look: "value" };
}

const labelOf = (states: FieldStates, fieldId: FieldId) =>
  t(t.variant(`field.${fieldId}.label`, chosenHazardType(states)));

// Where a value came from, with the reporter's own words when it was read from them.
function originOf(state: FieldState | undefined, { forStaff, door }: DocumentSource): string {
  if (state === undefined || !("origin" in state)) return "";
  if (state.origin === "quote") return t("document.origin.quote", { quote: state.quote });
  if (state.origin === "officer" && forStaff) return t("document.origin.officer", { quote: state.quote });
  return t(t.variant(`desk.origin.${state.origin}`, door));
}

const FIGURES = ["dead", "missing", "injured", "displacedPeople", "housesHeavy"] as const;

function figuresBlock(states: FieldStates): DocumentBlock {
  const applicable = new Set(applicableFields(states).map((field) => field.id));
  return {
    kind: "figures",
    figures: FIGURES.filter((fieldId) => applicable.has(fieldId)).map((fieldId) => {
      const { counts, none } = tallyOf(states, [fieldId]);
      const label = t(fieldId === "housesHeavy" ? "document.figure.housesHeavy" : `field.${fieldId}.label`);
      const [known] = counts;
      if (known !== undefined)
        return {
          label,
          value: known.count.toLocaleString("id-ID"),
          unit: t(fieldId === "housesHeavy" ? "unit.houses" : "unit.people"),
          known: true,
        };
      const isNone = none.length > 0;
      return { label, value: t(isNone ? "state.none" : "state.notYetKnown"), unit: null, known: isNone };
    }),
  };
}

// "2 orang meninggal; hilang tidak ada; luka-luka belum diketahui".
function tallyText(states: FieldStates, fieldIds: readonly FieldId[]): string {
  const applicable = new Set(applicableFields(states).map((field) => field.id));
  const tally = tallyOf(
    states,
    fieldIds.filter((fieldId) => applicable.has(fieldId)),
  );
  if (tally.counts.length + tally.unknown.length === 0) return t("document.tally.allNone");
  if (tally.counts.length + tally.none.length === 0) return t("document.tally.allUnknown");
  const words = (ids: readonly FieldId[]) => list.format(ids.map((fieldId) => t(`document.word.${fieldId}`)));
  return [
    ...(tally.counts.length === 0
      ? []
      : [list.format(tally.counts.map(({ fieldId, count }) => t(`document.count.${fieldId}`, { count })))]),
    ...(tally.none.length === 0 ? [] : [t("document.tally.none", { list: words(tally.none) })]),
    ...(tally.unknown.length === 0 ? [] : [t("document.tally.unknown", { list: words(tally.unknown) })]),
  ].join("; ");
}

function impactLines(states: FieldStates): string[] {
  const applicable = applicableFields(states);
  const has = (fieldId: FieldId) => applicable.some((field) => field.id === fieldId);
  const shelters = cellOf(states, "shelters");
  const displaced = tallyText(states, ["displacedPeople", "displacedFamilies"]);
  return [
    t("document.impact.victims", { tally: tallyText(states, ["dead", "missing", "injured", "injuredInpatient"]) }),
    has("shelters") && shelters.look === "value"
      ? t("document.impact.displacedAt", { tally: displaced, places: shelters.text })
      : t("document.impact.displaced", { tally: displaced }),
    ...(has("housesHeavy")
      ? [
          t("document.impact.houses", {
            tally: tallyText(states, ["housesHeavy", "housesModerate", "housesLight", "housesFlooded"]),
          }),
        ]
      : []),
    ...(has("schools")
      ? [
          t("document.impact.facilities", {
            tally: tallyText(states, ["schools", "healthFacilities", "worshipPlaces", "roads"]),
          }),
        ]
      : []),
    t("document.impact.services", { value: cellOf(states, "disruptedServices").text }),
    ...applicable
      .filter((field) => field.group === "specific" && states[field.id as FieldId] !== undefined)
      .map((field) =>
        t("document.impact.specific", {
          label: labelOf(states, field.id as FieldId),
          value: cellOf(states, field.id as FieldId).text,
        }),
      ),
  ];
}

function headline(states: FieldStates): string {
  const place = placeOf(states);
  const where = { regency: place.regencyName, province: place.provinceName };
  const hazardType = chosenHazardType(states);
  if (hazardType === null || hazardType === "other") return t("document.headline.unknown", where);
  const hazard = hazardKey(hazardType);
  const subtype = states.hazardSubtype;
  if (subtype?.state !== "value" || subtype.value === "unknown") return t("document.headline", { hazard, ...where });
  const words = t(`hazardSubtype.${hazardType}.${subtype.value as string}.label`).toLowerCase();
  return t("document.headline.subtype", { hazard, subtype: words, ...where });
}

function whereLine(states: FieldStates): string {
  const place = placeOf(states);
  const names = {
    village: place.villageName,
    district: place.districtName,
    regency: place.regencyName,
    province: place.provinceName,
  };
  const neighbourhood = cellOf(states, "neighbourhood");
  return neighbourhood.look === "value"
    ? t("document.place.neighbourhood", { ...names, neighbourhood: neighbourhood.text })
    : t("document.place", names);
}

function narrative(source: DocumentSource): DocumentBlock[] {
  const { states } = source;
  return [
    { kind: "headline", text: headline(states) },
    {
      kind: "numbered",
      items: [
        { label: t("field.place.label"), lines: [whereLine(states)] },
        { label: t("field.eventTime.label"), lines: [cellOf(states, "eventTime").text] },
        { label: t("field.chronology.label"), lines: [cellOf(states, "chronology").text] },
        { label: t("document.impact"), lines: impactLines(states) },
        { label: t("document.needs"), lines: [cellOf(states, "urgentNeeds").text] },
        {
          label: t("document.source"),
          lines: [t(`document.source.${source.reporterRole}`, { appName: "app.name", at: at(source.sentAt) })],
        },
      ],
    },
  ];
}

// What this version says that the one before it did not.
function changeBlocks(source: DocumentSource): DocumentBlock[] {
  const { change } = source;
  if (change === null) return [];
  const changes = versionChanges(change.before, source.states);
  const maker = change.madeBy === "officer" ? "officer" : "followUp";
  const plain = (text: string): DocumentBlock => ({ kind: "paragraph", text, small: false });
  return [
    { kind: "section", text: t("document.changes.title", { version: source.version - 1 }) },
    plain(t(`document.changes.${maker}`, { at: at(source.versionAt) })),
    ...(change.note === null ? [] : [plain(t("document.changes.note", { note: change.note }))]),
    ...(changes.length === 0
      ? [plain(t("document.changes.none"))]
      : [
          {
            kind: "table" as const,
            widths: [0.32, 0.34, 0.34],
            head: ["field", "from", "to"].map((column) => t(`document.col.${column}`)),
            rows: changes.map(({ fieldId }): Cell[] => [
              { text: labelOf(source.states, fieldId), look: "label" },
              { ...cellOf(change.before, fieldId), look: "empty" },
              cellOf(source.states, fieldId),
            ]),
          },
        ]),
    ...(change.newPhotos === 0 ? [] : [plain(t("document.changes.photos", { count: change.newPhotos }))]),
  ];
}

function reporterBlocks(source: DocumentSource): DocumentBlock[] {
  const line = (key: string, text: string): Cell[] => [
    { text: t(key), look: "label" },
    { text, look: "value" },
  ];
  return [
    { kind: "section", text: t("document.reporter") },
    {
      kind: "table",
      widths: [0.32, 0.68],
      head: null,
      rows: [
        line("document.reporter.role", t(`document.reporter.role.${source.reporterRole}`)),
        ...(source.officerRegency === null
          ? []
          : [line("document.reporter.agency", t("document.reporter.agencyValue", { regency: source.officerRegency }))]),
        line(
          "document.reporter.number",
          t(`document.reporter.number.${source.numberUnverified ? "unverified" : "verified"}`),
        ),
        line("document.reporter.sentAt", at(source.sentAt)),
        ...(source.change === null ? [] : [line("document.reporter.versionAt", at(source.versionAt))]),
      ],
    },
  ];
}

// Every value by its group. The chronology is told whole in the narrative.
function valueBlocks(source: DocumentSource): DocumentBlock[] {
  const { states } = source;
  const line = (row: SummaryRow): Cell[] => {
    const fieldId = row.fieldId as FieldId;
    const cell = cellOf(states, fieldId);
    const point = row.value?.kind === "place" ? row.value.point : null;
    const where =
      point === null ? "" : `. ${t("document.point", { lat: point.lat.toFixed(5), lon: point.lon.toFixed(5) })}`;
    return [
      { text: labelOf(states, fieldId), look: "label" },
      { ...cell, text: `${cell.text}${where}` },
      { text: originOf(states[fieldId], source), look: "words" },
    ];
  };
  return [
    { kind: "section", text: t("document.values") },
    {
      kind: "table",
      widths: [0.28, 0.38, 0.34],
      head: ["field", "value", "origin"].map((column) => t(`document.col.${column}`)),
      rows: summaryGroups(states).flatMap((group) => [
        t(`group.${group.groupId}.label`),
        ...group.rows.filter((row) => row.fieldId !== "chronology").map(line),
      ]),
    },
  ];
}

function photoBlocks(source: DocumentSource): DocumentBlock[] {
  const { photos, photosLeft } = source;
  const plain = (text: string): DocumentBlock => ({ kind: "paragraph", text, small: false });
  return [
    { kind: "section", text: t("document.photos") },
    ...(photos.length + photosLeft === 0 ? [plain(t("document.photos.none"))] : []),
    ...(photos.length === 0
      ? []
      : [
          {
            kind: "photos" as const,
            photos: photos.map((photo, index) => ({
              picture: photo.picture,
              caption: t(photo.far ? "document.photos.captionFar" : "document.photos.caption", {
                n: index + 1,
                badge: `card.photos.badge.${photo.badge}`,
                at: at(photo.takenAt),
              }),
            })),
          },
        ]),
    ...(photosLeft === 0 ? [] : [plain(t("document.photos.left", { count: photosLeft }))]),
  ];
}

function bands(source: DocumentSource): DocumentBlock[] {
  const { emergency, change } = source;
  return [
    ...(emergency === null
      ? []
      : [
          {
            kind: "band" as const,
            tone: "alarm" as const,
            text: t(`document.band.emergency.${emergency.victims}`),
          },
        ]),
    { kind: "band", tone: "notice", text: t(`document.band.${source.reporterRole}`) },
    ...(change === null
      ? []
      : [
          {
            kind: "band" as const,
            tone: "plain" as const,
            text: t(`document.band.${change.madeBy === "officer" ? "officer" : "followUp"}`),
          },
        ]),
  ];
}

export function documentOf(source: DocumentSource): ReportDocument {
  const { ticketNumber, version } = source;
  return {
    title: t("document.title", { ticketNumber, version }),
    madeAt: new Date(source.versionAt.utc),
    emblem: EMBLEM,
    emblemText: t("document.emblem"),
    agency: t("home.contact.organisation"),
    heading: t("document.heading"),
    lead: t("document.lead", { appName: "app.name" }),
    ticketLabel: t("document.ticket"),
    ticketNumber,
    version: t("document.version", { version }),
    blocks: [
      ...bands(source),
      figuresBlock(source.states),
      ...changeBlocks(source),
      ...narrative(source),
      ...reporterBlocks(source),
      ...valueBlocks(source),
      ...photoBlocks(source),
      { kind: "paragraph", text: t("document.note", { appName: "app.name" }), small: true },
    ],
    footer: t("document.footer", { appName: "app.name", ticketNumber, version }),
    page: t("document.page"),
    pageOf: t("document.pageOf"),
  };
}
