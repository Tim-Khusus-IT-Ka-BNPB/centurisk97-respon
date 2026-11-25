import type { OwnReportDetail } from "../contract/ownReport";
import type { Principal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { checkLimits, type LimitRefusal } from "./limits";
import { ownedReport, trackingOf, trackingToken } from "./tracking";
import { versionsOf } from "./versions";

export type OwnReportAnswer =
  | { readonly kind: "ok"; readonly body: OwnReportDetail }
  | { readonly kind: "notFound" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// A report on the phone or session that sent it. Anyone else is told it does not exist.
export async function readOwnReport(
  bindings: ServiceBindings,
  principal: Principal,
  address: string,
  ticketNumber: string,
): Promise<OwnReportAnswer> {
  const refusal = await checkLimits(bindings, [["address.draftReads", { kind: "address", bucket: address }]]);
  if (refusal) return { kind: "limit", refusal };
  const report = await ownedReport(bindings, principal, ticketNumber);
  if (report === null) return { kind: "notFound" };
  const [tracking, token, versions] = await Promise.all([
    trackingOf(bindings, report),
    trackingToken(bindings.settings.keyHmacSecret, report.id),
    versionsOf(bindings, ticketNumber, report.villageCode),
  ]);
  return { kind: "ok", body: { tracking, trackingToken: token, versions } };
}
