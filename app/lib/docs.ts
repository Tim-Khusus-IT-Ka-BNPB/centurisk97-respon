// The order of the text pages: catalogue keys are flat, the reading order lives here.
export const HELP_GROUPS = [
  {
    group: "reporting",
    items: [
      "prepare",
      "emergency",
      "sigap",
      "storyLanguage",
      "correct",
      "placeRequired",
      "noVillageName",
      "forOthers",
      "media",
      "missing",
      "language",
      "official",
      "free",
      "whyNumber",
      "words",
      "unsent",
    ],
  },
  { group: "after", items: ["who", "track", "addNews", "contact", "notActioned"] },
  { group: "terms", items: ["displaced", "familyCard", "houseDamage", "shakingScale", "levels", "agencies"] },
  { group: "status", items: ["meaning", "missing", "numbers"] },
  { group: "info", items: ["outlook", "warnings"] },
  { group: "privacy", items: ["who", "location", "remove"] },
] as const;

// In the order UU 27/2022 asks a notice to tell it (upstream, 25 Nov).
export const PRIVACY_SECTIONS = [
  { section: "who", parts: ["p1"] },
  { section: "collected", parts: ["p1", "item1", "item2", "item3", "item4", "item5", "p2"] },
  { section: "device", parts: ["p1", "item1", "item2", "item3", "item4", "p2"] },
  { section: "basis", parts: ["item1", "item2", "item3"] },
  { section: "use", parts: ["item1", "item2", "item3", "item4", "item5", "item6", "p2"] },
  { section: "assistant", parts: ["p1"] },
  { section: "access", parts: ["item1", "item2", "item3"] },
  { section: "others", parts: ["item1", "item3", "item4", "p2"] },
  { section: "storage", parts: ["p1"] },
  { section: "retention", parts: ["item1", "item2", "item3", "item4"] },
  { section: "rights", parts: ["p1", "item1", "item2", "item3", "item4", "item5", "item6"] },
  { section: "breach", parts: ["p1"] },
  { section: "falseReports", parts: ["p1"] },
  { section: "changes", parts: ["p1"] },
  { section: "contact", parts: ["p1"] },
] as const;

export const PRIVACY_META = ["effective", "kind", "audience", "language"] as const;

export const ABOUT_POINTS = ["guided", "ticket", "ownWords"] as const;
export const ABOUT_STEPS = [1, 2, 3, 4, 5, 6] as const;

export const CONTACT_ROWS = [
  { label: "home.contact.callCenterLabel", value: "home.contact.callCenter", link: "tel", icon: "headset" },
  { label: "home.contact.phoneLabel", value: "home.contact.phone", link: "tel", icon: "phone" },
  { label: "home.contact.emailLabel", value: "home.contact.email", link: "mail", icon: "mail" },
  { label: "home.contact.websiteLabel", value: "home.contact.website", link: "web", icon: "globe" },
  { label: "home.contact.addressLabel", value: "home.contact.address", link: null, icon: "mapPin" },
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
