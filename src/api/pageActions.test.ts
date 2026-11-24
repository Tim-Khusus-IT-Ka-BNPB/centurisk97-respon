import { describe, expect, test } from "vitest";
import type { MeResponse } from "../contract/draft";
import { hmacKey } from "../platform/keys";
import { freshAddress, freshNumber, query, TEST_ORIGIN, testBindings } from "../testing/api";
import { cameraJpeg } from "../testing/photoBase";
import { api } from "./app";
import { createBridge } from "./bridge";
import { draftPageAction, type PageResult, startStepAction } from "./pageActions";

const { bindings } = testBindings();
const fetchApi = async (request: Request) => api.app.fetch(request, bindings);

// One browser posting page forms: its cookie jar and address, as the Worker's bridge sees them.
function page() {
  let cookie = "";
  const address = freshAddress();
  const bridge = () =>
    createBridge(
      fetchApi,
      TEST_ORIGIN,
      new Request(`${TEST_ORIGIN}/lapor/report`, {
        method: "POST",
        headers: { origin: TEST_ORIGIN, "cf-connecting-ip": address, cookie },
      }),
    );
  const post = async (fields: Record<string, string | string[]>) => {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) for (const one of [value].flat()) form.append(name, one);
    const result = await startStepAction(form, bridge());
    if (result.kind === "redirect")
      for (const line of result.headers.getSetCookie()) cookie = line.split(";")[0] as string;
    return result;
  };
  const draft = async (draftId: string, fields: Record<string, string | string[]>) => {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) for (const one of [value].flat()) form.append(name, one);
    return draftPageAction(draftId, form, bridge());
  };
  const me = async () => (await (await bridge()("GET", "/me")).json()) as MeResponse;
  const form = async (draftId: string, fields: FormData) => draftPageAction(draftId, fields, bridge());
  return { post, draft, form, me };
}

const rendered = (result: PageResult) => result as Extract<PageResult, { kind: "render" }>;
const located = (result: PageResult) => result as Extract<PageResult, { kind: "redirect" }>;

async function stored(number: string) {
  const key = await hmacKey(bindings.settings.keyHmacSecret, "number", number);
  return (await query`select 1 from reporter where number_key = ${key}`).length;
}

describe("start step with no script", () => {
  test("the number reads back the same however it is typed, with every value kept and nothing stored", async () => {
    const number = freshNumber();
    const national = number.stored.slice(3);
    for (const typed of [`0${national}`, `62${national}`, `+62${national}`]) {
      const result = rendered(
        await page().post({ action: "readBack", role: "citizen", name: "Uji Satu", number: typed }),
      );
      expect(result.view).toBe("readBack");
      expect(result.readBack).toBe(`+62 ${national.slice(0, 3)} ${national.slice(3, 7)} ${national.slice(7)}`);
      expect(result.values).toEqual({
        role: "citizen",
        name: "Uji Satu",
        number: typed,
        officerRegency: "",
        officerPosition: "",
      });
    }
    expect(await stored(number.stored)).toBe(0);
  });

  test("the session path reads back no number", async () => {
    const result = rendered(await page().post({ action: "readBack", role: "citizen", name: "Uji Dua" }));
    expect(result).toMatchObject({ view: "readBack", readBack: null, status: 200 });
  });

  test("a refused read-back redraws the form with the field errors", async () => {
    const result = rendered(
      await page().post({
        action: "readBack",
        role: "claimedOfficer",
        name: "Uji Satu",
        number: "0800",
        officerRegency: "Kabupaten Contoh",
        officerPosition: "",
      }),
    );
    expect(result.status).toBe(422);
    expect(result.view).toBe("form");
    expect(result.envelope?.fields.map((error) => error.fieldId)).toEqual(["number", "officerPosition"]);
  });

  test("decline, its way back, and the final decline store nothing; the decline draws no value again", async () => {
    const number = freshNumber();
    const browser = page();
    const values = { role: "citizen", name: "Uji Dua", number: number.typed };
    expect(rendered(await browser.post({ action: "decline", ...values })).view).toBe("declineConfirm");
    const back = rendered(await browser.post({ action: "declineBack", ...values }));
    expect(back.view).toBe("form");
    expect(back.values.name).toBe("Uji Dua");
    const declined = rendered(await browser.post({ action: "declineConfirm", ...values }));
    expect(declined.view).toBe("declined");
    expect(declined.values.name).toBe("");
    expect(await stored(number.stored)).toBe(0);
  });

  test("consent redirects to the draft and hands the device cookie to the browser", async () => {
    const browser = page();
    const result = located(
      await browser.post({ action: "consent", role: "citizen", name: "Uji Satu", number: freshNumber().typed }),
    );
    expect(result.location).toMatch(/^\/lapor\/report\/[0-9a-f-]{36}$/);
    expect(result.headers.get("set-cookie")).toMatch(/^device_key=/);
    expect((await browser.me()).knownReporters).toHaveLength(1);
    const refused = rendered(
      await browser.post({ action: "consent", role: "citizen", name: "Uji 1", number: freshNumber().typed }),
    );
    expect(refused.status).toBe(422);
  });

  test("a known number: open draft asks to replace, replacing starts anew, Ganti edits the profile", async () => {
    const browser = page();
    await browser.post({ action: "consent", role: "citizen", name: "Uji Satu", number: freshNumber().typed });
    const profileId = (await browser.me()).knownReporters[0]?.profileId as string;
    const asked = rendered(await browser.post({ action: "useProfile", profileId }));
    expect(asked.view).toBe("replaceConfirm");
    expect(asked.status).toBe(409);
    expect(asked.profileId).toBe(profileId);
    const replaced = located(
      await browser.post({
        action: "replaceOpenDraft",
        profileId,
        editProfile: "1",
        role: "citizen",
        name: "Uji Tiga",
      }),
    );
    expect(replaced.location).toMatch(/^\/lapor\/report\//);
    expect((await browser.me()).knownReporters[0]?.name).toBe("Uji Tiga");
    expect(
      rendered(await browser.post({ action: "useProfile", profileId: "00000000-0000-4000-8000-000000000000" })).status,
    ).toBe(404);
  });

  test("removal asks first and removes only with the confirm", async () => {
    const browser = page();
    await browser.post({ action: "consent", role: "citizen", name: "Uji Satu", number: freshNumber().typed });
    const profileId = (await browser.me()).knownReporters[0]?.profileId as string;
    expect(rendered(await browser.post({ action: "removeProfileAsk", profileId })).view).toBe("removeConfirm");
    expect(rendered(await browser.post({ action: "removeProfile", profileId })).view).toBe("removeConfirm");
    expect(located(await browser.post({ action: "removeProfile", profileId, confirm: "yes" })).location).toBe(
      "/lapor/report",
    );
    expect((await browser.me()).knownReporters).toEqual([]);
    expect(rendered(await browser.post({ action: "removeProfile", profileId, confirm: "yes" })).status).toBe(404);
  });

  test("an unknown action is refused", async () => {
    expect(rendered(await page().post({ action: "nonsense" })).status).toBe(400);
  });
});

describe("draft page with no script", () => {
  test("a turn redirects back to the draft; a stale one redraws with the current draft; a send redirects", async () => {
    const browser = page();
    const created = located(
      await browser.post({ action: "consent", role: "citizen", name: "Uji Satu", number: freshNumber().typed }),
    );
    const draftId = created.location.split("/").at(-1) as string;
    const [village] = await query<{ code: string }>`
      select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active order by v.code limit 1`;
    const turn = {
      revision: "0",
      turnKey: crypto.randomUUID(),
      cardId: "c-0",
      villageCode: (village as { code: string }).code,
    };
    expect(located(await browser.draft(draftId, turn)).location).toBe(`/lapor/report/${draftId}`);
    const stale = rendered(await browser.draft(draftId, { ...turn, turnKey: crypto.randomUUID() }));
    expect(stale.status).toBe(409);
    expect(stale.envelope?.draft?.card.kind).toBe("neighbourhood");
    const boxes = {
      revision: "1",
      turnKey: crypto.randomUUID(),
      cardId: "c-1",
      kind: "answer",
      "value.rt": "1",
      "value.rw": "",
      optionIds: [],
    };
    expect(located(await browser.draft(draftId, boxes)).location).toBe(`/lapor/report/${draftId}`);
    const send = rendered(
      await browser.draft(draftId, { action: "send", revision: "2", turnKey: crypto.randomUUID() }),
    );
    expect(send.status).toBe(409);
    const [row] = await query<{
      fields: { states: { neighbourhood: unknown } };
    }>`select fields from report_draft where id = ${draftId}`;
    expect(row?.fields.states.neighbourhood).toEqual({
      state: "value",
      value: { rt: "1", rw: null },
      origin: "boxEntry",
    });
  });
});

describe("photo form with no script", () => {
  test("the file and the reading boxes go to the photo route, and its refusal redraws the draft", async () => {
    const browser = page();
    const created = located(
      await browser.post({ action: "consent", role: "citizen", name: "Uji Satu", number: freshNumber().typed }),
    );
    const draftId = created.location.split("/").at(-1) as string;
    const form = new FormData();
    form.set("action", "photo");
    form.set("revision", "0");
    form.set("turnKey", crypto.randomUUID());
    form.set("photo", new File([new Uint8Array(cameraJpeg({ make: "Uji" }))], "foto.jpg", { type: "image/jpeg" }));
    for (const name of ["lat", "lon", "accuracy", "readAt", "offset"]) form.set(`value.${name}`, "");
    const refused = rendered(await browser.form(draftId, form));
    expect(refused.status).toBe(422);
    expect(refused.envelope?.fields).toEqual([{ fieldId: "photo", copyKey: "fieldError.photo.notNow", params: {} }]);
    form.delete("photo");
    expect(rendered(await browser.form(draftId, form)).status).toBe(400);
  });
});

describe("Ganti on a known number with no script", () => {
  const consented = async () => {
    const phone = page();
    const number = freshNumber();
    const made = located(
      await phone.post({ action: "consent", role: "citizen", name: "Uji Satu", number: number.typed }),
    );
    const draftId = made.location.split("/").at(-1) as string;
    const [profile] = await query<{ id: string }>`select profile_id as id from report_draft where id = ${draftId}`;
    return { phone, profileId: (profile as { id: string }).id };
  };
  const nameOf = async (profileId: string) =>
    ((await query<{ name: string }>`select name from reporter_profile where id = ${profileId}`)[0] as { name: string })
      .name;

  test("a changed name is stored when no draft is open", async () => {
    const { phone, profileId } = await consented();
    await query`update report_draft set state = 'cancelled', end_reason = 'cancelled', ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      fields = null, back_stack = null where profile_id = ${profileId}`;
    const result = await phone.post({
      action: "useProfile",
      profileId,
      editProfile: "1",
      role: "citizen",
      name: "Uji Dua",
    });
    expect(result.kind).toBe("redirect");
    expect(await nameOf(profileId)).toBe("Uji Dua");
  });

  test("a changed name survives the replace confirm: the confirm keeps the values and the replace stores them", async () => {
    const { phone, profileId } = await consented();
    const edit = { profileId, editProfile: "1", role: "citizen", name: "Uji Tiga" };
    const asked = rendered(await phone.post({ action: "useProfile", ...edit }));
    expect(asked.view).toBe("replaceConfirm");
    expect(asked.values.name).toBe("Uji Tiga");
    expect(await nameOf(profileId)).toBe("Uji Satu");
    expect((await phone.post({ action: "replaceOpenDraft", ...edit })).kind).toBe("redirect");
    expect(await nameOf(profileId)).toBe("Uji Tiga");
  });
});
