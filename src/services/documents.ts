import { deskReport, logDocument } from "../adapters/d1/desk";
import { draftPhotos } from "../adapters/d1/photos";
import { versionDetail } from "../adapters/d1/versions";
import { renderDocx } from "../adapters/document/docx";
import { renderPdf } from "../adapters/document/pdf";
import { utf8, zip } from "../adapters/document/zip";
import type { ReportVersion } from "../contract/ownReport";
import { copy } from "../copy";
import type { DocumentFormat, ReportDocument } from "../domain/document";
import type { Zone } from "../domain/eventTime";
import type { Principal, StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { admitted } from "./desk";
import { type DocumentPhoto, documentOf, pictureOf } from "./documentContent";
import { at, draftZone } from "./draftView";
import { checkLimits, type LimitRefusal } from "./limits";
import { ownedReport } from "./tracking";
import { versionsOf } from "./versions";

// Photos of one document stay under this many bytes together, so a Worker can hold the file while
// it is made. The document says how many it left out.
const PHOTO_BYTES = 12 * 1024 * 1024;

type Photos = { readonly photos: readonly DocumentPhoto[]; readonly left: number; readonly added: number };

// The photos a version holds: its own and those that came before it.
async function photosOf(bindings: ServiceBindings, draftId: string, version: number, zone: Zone): Promise<Photos> {
  const photos: DocumentPhoto[] = [];
  let bytes = 0;
  const kept = (await draftPhotos(bindings.db, draftId)).filter((photo) => photo.version <= version);
  for (const photo of kept) {
    const file = await bindings.photos.get(photo.storeKey);
    const picture = file === null ? null : pictureOf(file);
    if (picture === null || bytes + picture.bytes.length > PHOTO_BYTES) continue;
    bytes += picture.bytes.length;
    photos.push({ picture, badge: photo.badge, far: photo.far, takenAt: at(photo.takenAtMs, zone) });
  }
  const added = kept.filter((photo) => photo.version === version).length;
  return { photos, left: kept.length - photos.length, added };
}

type Made = { readonly document: ReportDocument; readonly photos: Photos };

// One version of a report as a document, or null when there is no such version.
async function documentFor(
  bindings: ServiceBindings,
  ticketNumber: string,
  version: number,
  forStaff: boolean,
): Promise<Made | null> {
  const found = await versionDetail(bindings.db, ticketNumber, version);
  if (found === null) return null;
  const before = version === 1 ? null : await versionDetail(bindings.db, ticketNumber, version - 1);
  const zone = draftZone(found.villageCode);
  const photos = await photosOf(bindings, found.draftId, version, zone);
  const document = documentOf({
    ticketNumber,
    version,
    sentAt: at(found.sentAt, zone),
    versionAt: at(found.createdAt, zone),
    states: found.states,
    change:
      before === null
        ? null
        : { before: before.states, madeBy: found.madeBy, note: forStaff ? found.note : null, newPhotos: photos.added },
    reporterRole: found.reporterRole,
    officerRegency: found.officerRegency,
    numberUnverified: found.numberUnverified,
    door: found.door,
    emergency: found.emergency,
    photos: photos.photos,
    photosLeft: photos.left,
    forStaff,
  });
  return { document, photos };
}

const WRITERS = {
  pdf: { render: renderPdf, mime: "application/pdf" },
  docx: {
    render: renderDocx,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
} as const;

export type DocumentAnswer =
  | { readonly kind: "file"; readonly bytes: Uint8Array; readonly mime: string; readonly name: string }
  | { readonly kind: "notFound" }
  | { readonly kind: "notAllowed" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

async function written(made: Made | null, format: DocumentFormat): Promise<DocumentAnswer> {
  if (made === null) return { kind: "notFound" };
  const { render, mime } = WRITERS[format];
  return { kind: "file", bytes: await render(made.document), mime, name: `${made.document.title}.${format}` };
}

// The reporter's own copy, on the phone or session that sent the report. Anyone else is told there
// is none.
export async function ownDocument(
  bindings: ServiceBindings,
  principal: Principal,
  ticketNumber: string,
  version: number,
  format: DocumentFormat,
): Promise<DocumentAnswer> {
  const report = await ownedReport(bindings, principal, ticketNumber);
  if (report === null) return { kind: "notFound" };
  const refusal = await checkLimits(bindings, [
    ["document.hour", { kind: "numberSlot", numberKey: report.numberKey, ownerSlot: report.ownerSlot }],
  ]);
  if (refusal) return { kind: "limit", refusal };
  return written(await documentFor(bindings, ticketNumber, version, false), format);
}

// The reporter's own copy for their chat, which its caller knows the report is of.
export const chatDocument = async (bindings: ServiceBindings, ticketNumber: string, version: number) =>
  written(await documentFor(bindings, ticketNumber, version, false), "pdf");

// Staff's copy, for an account whose region holds the report; logged, as it leaves the desk.
export async function deskDocument(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  version: number,
  format: DocumentFormat,
): Promise<DocumentAnswer> {
  const refused = await admitted(bindings, staff, "downloadDocument", "desk.write");
  if (refused) return refused;
  if ((await deskReport(bindings.db, staff.scope, ticketNumber)) === null) return { kind: "notFound" };
  const answer = await written(await documentFor(bindings, ticketNumber, version, true), format);
  if (answer.kind === "file")
    await logDocument(bindings.db, staff, ticketNumber, "document", new Date(bindings.clock.now()));
  return answer;
}

// An emergency's newest version in one file, to hand on at once: the document in both formats and
// the photos as they are. Logged once, as one download.
export async function deskDocumentPack(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
): Promise<DocumentAnswer> {
  const refused = await admitted(bindings, staff, "downloadDocument", "desk.write");
  if (refused) return refused;
  const found = await deskReport(bindings.db, staff.scope, ticketNumber);
  if (found === null || found.emergency === null) return { kind: "notFound" };
  const [newest] = await versionsOf(bindings, ticketNumber, found.villageCode);
  const { document, photos } = (await documentFor(
    bindings,
    ticketNumber,
    (newest as ReportVersion).version,
    true,
  )) as Made;
  const bytes = await zip([
    { name: `${document.title}.pdf`, bytes: renderPdf(document) },
    { name: `${document.title}.docx`, bytes: await renderDocx(document) },
    ...photos.photos.map((photo, index) => ({
      name: copy.format("document.pack.photo", { n: String(index + 1).padStart(2, "0") }),
      bytes: photo.picture.bytes,
    })),
    ...(photos.left === 0
      ? []
      : [
          {
            name: copy.text("document.pack.read"),
            bytes: utf8(copy.format("document.photos.left", { count: photos.left })),
          },
        ]),
  ]);
  await logDocument(bindings.db, staff, ticketNumber, "documentPack", new Date(bindings.clock.now()));
  return {
    kind: "file",
    bytes,
    mime: "application/zip",
    name: copy.format("document.pack.name", { ticketNumber }),
  };
}
