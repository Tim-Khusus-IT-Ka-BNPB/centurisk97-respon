import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ErrorEnvelope } from "../../src/contract/errors";
import { makeText } from "../../src/copy/text";
import { clockTime, localClockText, localDateText, longDate, retryText } from "../../src/copy/time";
import { unitKeyOf } from "../../src/copy/units";
import { SAMPLE_DRAFTS, SAMPLE_FIELD_ERROR, SAMPLE_STALE_TURN } from "../../src/testing/samples";
import { text as t } from "../testing/render";
import { isFinalCard } from "./cards";
import { contactHref } from "./docs";
import { cardProblem, errorIdOf, firstInvalid, hintIdOf, isLimit, problemOf } from "./envelope";
import { settleExclusive } from "./exclusive";
import { pageMeta } from "./meta";
import { isLost, LOST, withinTimeout } from "./network";
import { breakAfterSlash } from "./slash";
import { postedOf, postedValue, toTurnForm } from "./turnForm";

const limitEnvelope = (retryAt: ErrorEnvelope["retryAt"]): ErrorEnvelope => ({
  error: { code: "limit.message.minute", copyKey: "limit.message.minute", params: { limit: 20 } },
  fields: [],
  retryAt,
  draft: SAMPLE_DRAFTS.numberForm,
});

describe("copy for a page", () => {
  test("a param that is itself a key is looked up before it is shown", () => {
    const text = makeText({ "a.b": "Halo {name} di {place}", "c.d": "Banjir" });
    expect(text("a.b", { name: "c.d", place: "desa" })).toBe("Halo Banjir di desa");
    expect(text("a.b", { name: 3, place: "x" })).toBe("Halo 3 di x");
    expect(text.has("a.b")).toBe(true);
    expect(text.has("z.z")).toBe(false);
  });

  test("a per-hazard variant is used when it exists, else the base key", () => {
    const text = makeText({ "field.x.label": "Lahan", "field.x.label.flood": "Sawah" });
    expect(text.variant("field.x.label", "flood")).toBe("field.x.label.flood");
    expect(text.variant("field.x.label", "drought")).toBe("field.x.label");
    expect(text.variant("field.x.label", null)).toBe("field.x.label");
  });

  test("a page's meta carries its title, description, absolute links and share card", () => {
    const texts = {
      "app.name": "Pantau",
      "page.help.title": "Bantuan, {appName}",
      "meta.help.description": "Cara memakai {appName}.",
      "meta.image.alt": "{appName}, lapor",
    };
    const matches = [{ id: "root", data: { origin: "https://respon.example.test" } }];
    const tags = pageMeta(
      { data: { texts }, matches },
      { title: "page.help.title", description: "meta.help.description", path: "/help" },
    );
    const value = (key: string) =>
      (tags.find((tag) => Object.values(tag).includes(key)) as Record<string, string> | undefined)?.content;
    expect(tags[0]).toEqual({ title: "Bantuan, Pantau" });
    expect(value("description")).toBe("Cara memakai Pantau.");
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://respon.example.test/help" });
    expect(value("og:url")).toBe("https://respon.example.test/help");
    expect(value("og:image")).toBe("https://respon.example.test/og/respon.png");
    expect(value("og:site_name")).toBe("Pantau");
    expect(value("og:image:alt")).toBe("Pantau, lapor");
    expect(value("twitter:card")).toBe("summary_large_image");
    expect(value("robots")).toBe("index, follow");
  });

  test("a private page is not indexed, and nothing is said before the page has copy", () => {
    const texts = {
      "app.name": "Pantau",
      "page.draft.title": "Draf",
      "meta.draft.description": "Laporan",
      "meta.image.alt": "x",
    };
    const hidden = pageMeta(
      { data: { texts }, matches: [] },
      { title: "page.draft.title", description: "meta.draft.description", path: "/report", index: false },
    );
    expect(hidden).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(
      pageMeta({ data: undefined, matches: [] }, { title: "page.help.title", description: "x", path: "/" }),
    ).toEqual([]);
  });
});

describe("times in the place's zone", () => {
  const instant = { utc: "2026-11-23T17:05:00.000Z", zone: "WIB" as const };

  test("a clock time and date are shown in the zone, not the phone's", () => {
    expect(clockTime(instant)).toBe("00.05");
    expect(longDate(instant)).toBe("24 November 2026");
    expect(clockTime({ ...instant, zone: "WIT" })).toBe("02.05");
    expect(clockTime({ ...instant, zone: "WITA" })).toBe("01.05");
    expect(localDateText("2026-11-23")).toBe("23 November 2026");
    expect(localClockText("14:30")).toBe("14.30");
  });

  test("a retry time names the day only when it is not today there", () => {
    const now = Date.parse("2026-11-23T18:00:00.000Z");
    expect(retryText(instant, now)).toEqual({
      key: "common.retryTime.today",
      params: { time: "00.05", zone: "WIB", date: "24 November" },
    });
    expect(retryText(instant, Date.parse("2026-11-23T10:00:00.000Z"))).toEqual({
      key: "common.retryTime.otherDay",
      params: { time: "00.05", zone: "WIB", date: "24 November" },
    });
  });
});

describe("a posted form", () => {
  test("boxes go under value., controls stay, the busy marker is dropped", () => {
    const form = new FormData();
    for (const [name, value] of [
      ["action", "turn"],
      ["optionIds", "a"],
      ["optionIds", "b"],
      ["dead", "2"],
      ["intent", "save"],
      ["text", "air naik"],
    ] as const)
      form.append(name, value);
    expect([...toTurnForm(form)]).toEqual([
      ["action", "turn"],
      ["optionIds", "a"],
      ["optionIds", "b"],
      ["value.dead", "2"],
      ["text", "air naik"],
    ]);
  });

  test("every value comes back as sent, and a missing one falls back to the card's", () => {
    const form = new FormData();
    form.append("optionIds", "a");
    form.append("optionIds", "b");
    form.append("dead", "2");
    form.append("photo", new Blob(["x"]));
    const posted = postedOf(form);
    expect(posted).toEqual({ optionIds: ["a", "b"], dead: ["2"] });
    expect(postedValue(posted, "dead", 5)).toBe("2");
    expect(postedValue(posted, "missing", 5)).toBe("5");
    expect(postedValue(null, "missing", null)).toBe("");
  });
});

describe("the error envelope", () => {
  test("a field's refusal is found by its id and the first refused field takes focus", () => {
    expect(problemOf(SAMPLE_FIELD_ERROR, "name")).toEqual({
      copyKey: "fieldError.name.digits",
      params: { label: "Nama" },
    });
    expect(problemOf(SAMPLE_FIELD_ERROR, "number")).toBeNull();
    expect(problemOf(null, "name")).toBeNull();
    expect(firstInvalid(SAMPLE_FIELD_ERROR, ["role", "name"])).toBe("name");
    expect(firstInvalid(null, ["role"])).toBeNull();
    expect(errorIdOf("name")).toBe("name-error");
    expect(hintIdOf("name")).toBe("name-hint");
  });

  test("a card-level notice is neither a field refusal nor a limit", () => {
    expect(cardProblem(SAMPLE_STALE_TURN)).toEqual({ copyKey: "error.draft.changed", params: {} });
    expect(cardProblem(SAMPLE_FIELD_ERROR)).toBeNull();
    expect(cardProblem(limitEnvelope(null))).toBeNull();
    expect(cardProblem(null)).toBeNull();
    expect(cardProblem({ ...SAMPLE_FIELD_ERROR, fields: [] })?.copyKey).toBe("error.request.invalidFields");
    expect(isLimit(limitEnvelope(null))).toBe(true);
    expect(isLimit(null)).toBe(false);
  });
});

describe("text with a slash", () => {
  test("a slash between letters gets a break opportunity after it; other text is left alone", () => {
    const { container } = render(<p>{breakAfterSlash("kecamatan, atau kabupaten/kota tempat")}</p>);
    expect(container.querySelectorAll("wbr")).toHaveLength(1);
    expect(container.textContent).toBe("kecamatan, atau kabupaten/kota tempat");
    expect(breakAfterSlash("tanpa garis")).toBe("tanpa garis");
    const digits = render(<p>{breakAfterSlash("RT 04/05 dan Desa/Kel. x")}</p>);
    expect(digits.container.querySelectorAll("wbr")).toHaveLength(1);
  });
});

describe("small rules", () => {
  test("ticking an exclusive option clears the others, ticking another clears the exclusive", () => {
    const box = (value: string, checked: boolean) => Object.assign(document.createElement("input"), { value, checked });
    const [elderly, children, none] = [box("elderly", true), box("children", true), box("none", true)];
    settleExclusive([elderly, children, none], none, new Set(["none"]));
    expect([elderly.checked, children.checked, none.checked]).toEqual([false, false, true]);
    elderly.checked = true;
    settleExclusive([elderly, children, none], elderly, new Set(["none"]));
    expect([elderly.checked, none.checked]).toEqual([true, false]);
    elderly.checked = false;
    children.checked = true;
    settleExclusive([elderly, children, none], elderly, new Set(["none"]));
    expect(children.checked).toBe(true);
  });

  test("a count field has a unit, others have none", () => {
    expect(unitKeyOf("dead")).toBe("unit.people");
    expect(unitKeyOf("hazardType")).toBeNull();
    expect(unitKeyOf("nothing")).toBeNull();
  });

  test("a contact link is made from its own value", () => {
    expect(contactHref("tel", "021 2982 7793")).toBe("tel:02129827793");
    expect(contactHref("mail", "a@b.id")).toBe("mailto:a@b.id");
    expect(contactHref("web", "bnpb.go.id")).toBe("https://bnpb.go.id");
    expect(contactHref(null, "x")).toBeNull();
  });

  test("only a sent or cancelled card is final", () => {
    expect(isFinalCard(SAMPLE_DRAFTS.sent.card)).toBe(true);
    expect(isFinalCard(SAMPLE_DRAFTS.cancelled.card)).toBe(true);
    expect(isFinalCard(SAMPLE_DRAFTS.summary.card)).toBe(false);
  });
});

describe("a turn on a weak connection", () => {
  test("an answer in time passes through", async () => {
    await expect(withinTimeout(Promise.resolve(7))).resolves.toBe(7);
  });

  test("a dropped connection or a slow answer becomes a lost turn", async () => {
    await expect(withinTimeout(Promise.reject(new TypeError("offline")))).resolves.toEqual(LOST);
    vi.useFakeTimers();
    const slow = withinTimeout(new Promise(() => undefined), 8000);
    vi.advanceTimersByTime(8000);
    await expect(slow).resolves.toEqual(LOST);
    vi.useRealTimers();
  });

  test("a redirect still reaches the router", async () => {
    const redirect = new Response(null, { status: 302 });
    await expect(withinTimeout(Promise.reject(redirect))).rejects.toBe(redirect);
  });

  test("a lost turn is told apart from any other answer", () => {
    expect(isLost(LOST)).toBe(true);
    expect(isLost({ networkLost: false })).toBe(false);
    expect(isLost(null)).toBe(false);
    expect(isLost("x")).toBe(false);
  });
});

test("the copy used in these tests is the real catalogue", () => {
  expect(t("notice.lifeLine.call")).toBe("Telepon 112");
});
