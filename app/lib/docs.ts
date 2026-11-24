// The order of the text pages: catalogue keys are flat, the reading order lives here.
export const HELP_GROUPS = [
  { group: "reporting", items: ["prepare", "placeRequired", "official", "words", "unsent"] },
  { group: "terms", items: ["displaced", "familyCard", "houseDamage", "shakingScale"] },
  { group: "status", items: ["meaning"] },
  { group: "privacy", items: ["who", "remove"] },
] as const;

export const PRIVACY_SECTIONS = [
  { section: "collected", parts: ["p1", "item1", "item2", "item3", "item4", "p2"] },
  { section: "use", parts: ["item1", "item2", "item3", "item4"] },
  { section: "assistant", parts: ["p1"] },
  { section: "access", parts: ["p1"] },
  { section: "storage", parts: ["p1", "p2"] },
  { section: "rights", parts: ["p1"] },
  { section: "falseReports", parts: ["p1"] },
  { section: "changes", parts: ["p1"] },
  { section: "contact", parts: ["p1"] },
] as const;

export const PRIVACY_META = ["effective", "kind", "audience", "language"] as const;

export const ABOUT_POINTS = ["guided", "ticket", "ownWords"] as const;
export const ABOUT_STEPS = [1, 2, 3, 4, 5, 6] as const;

export const CONTACT_ROWS = [
  { label: "home.contact.callCenterLabel", value: "home.contact.callCenter", link: "tel" },
  { label: "home.contact.phoneLabel", value: "home.contact.phone", link: "tel" },
  { label: "home.contact.emailLabel", value: "home.contact.email", link: "mail" },
  { label: "home.contact.websiteLabel", value: "home.contact.website", link: "web" },
  { label: "home.contact.addressLabel", value: "home.contact.address", link: null },
] as const;

// The link a contact value opens, made from the value itself so the two never disagree.
export function contactHref(link: "tel" | "mail" | "web" | null, value: string): string | null {
  if (link === "tel") return `tel:${value.replace(/[^\d+]/g, "")}`;
  if (link === "mail") return `mailto:${value}`;
  if (link === "web") return `https://${value}`;
  return null;
}

export const CONTACT_SOCIAL = [
  "home.contact.dataPortal",
  "home.contact.instagram",
  "home.contact.x",
  "home.contact.facebook",
  "home.contact.youtube",
  "home.contact.tiktok",
] as const;
