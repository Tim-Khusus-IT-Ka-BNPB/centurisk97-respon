import { referenceFile } from "../adapters/d1/reports";
import type { Tracking } from "../contract/tracking";
import { checkForecastFile, type Outlook, outlookOf } from "../domain/forecast";
import type { ServiceBindings } from "./bindings";
import { contactOf } from "./tracking";

export type OutlookAnswer =
  | { readonly kind: "unavailable" }
  | { readonly kind: "notFound" }
  | { readonly kind: "outlook"; readonly outlook: Outlook & { readonly contact: Tracking["contact"] } };

// A regency's outlook ("11.08") with its BPBD to call. No file, or one that breaks its contract,
// is "cannot know", never a calm answer.
export async function outlookFor(bindings: ServiceBindings, regencyCode: string): Promise<OutlookAnswer> {
  const file = checkForecastFile(await referenceFile(bindings.db, "forecast"));
  if (file === null) return { kind: "unavailable" };
  const outlook = outlookOf(file, regencyCode);
  if (outlook === null) return { kind: "notFound" };
  const contact = await contactOf(bindings, { villageCode: regencyCode, ...outlook });
  return { kind: "outlook", outlook: { ...outlook, contact } };
}
