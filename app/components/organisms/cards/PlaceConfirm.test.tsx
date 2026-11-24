import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Card } from "../../../../src/contract/card";
import type { DraftBody } from "../../../../src/contract/draft";
import { SAMPLE_DRAFTS } from "../../../../src/testing/samples";
import { TextContext } from "../../../lib/text";
import { never, renderDraft, text } from "../../../testing/render";
import { CardView } from "../CardView";
import { DraftContext } from "./CardShell";

type Posted = Record<string, FormDataEntryValue>;

// An action that keeps what each post carried, then never answers, so the busy state shows.
function recording() {
  const posts: Posted[] = [];
  const action = async ({ request }: { request: Request }) => {
    posts.push(Object.fromEntries(await request.formData()));
    return never();
  };
  return { posts, action };
}

// The server's render of a card: what a phone with no script receives.
let served: DraftBody = SAMPLE_DRAFTS.placeSearch;
function Served() {
  return (
    <TextContext.Provider value={text}>
      <DraftContext.Provider
        value={{ draft: served, turnKey: "k", envelope: null, posted: null, networkLost: false, lifeLine: false }}
      >
        <CardView card={served.card} />
      </DraftContext.Provider>
    </TextContext.Provider>
  );
}
function serverHtml(draft: DraftBody): string {
  served = draft;
  const Stub = createRoutesStub([{ path: "/", Component: Served }]);
  return renderToString(<Stub />);
}

const draw = (draft: DraftBody, options: Parameters<typeof renderDraft>[2] = {}) =>
  renderDraft(<CardView card={draft.card} />, draft, options);

type Outcome = { readonly code: number } | { readonly lat: number };
function stubGeolocation(...outcomes: Outcome[]) {
  vi.stubGlobal("navigator", {
    ...navigator,
    geolocation: {
      getCurrentPosition(ok: PositionCallback, fail: PositionErrorCallback) {
        const next = outcomes.shift() ?? { code: 2 };
        if ("code" in next) fail({ code: next.code } as GeolocationPositionError);
        else
          ok({
            coords: { latitude: next.lat, longitude: 97.0482, accuracy: 12 },
            timestamp: Date.now(),
          } as GeolocationPosition);
      },
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("place from GPS", () => {
  test("Pakai lokasi saat ini sends the reading as a turn", async () => {
    stubGeolocation({ lat: 5.14705 });
    const { posts, action } = recording();
    draw(SAMPLE_DRAFTS.placeSearch, { action });
    fireEvent.click(await screen.findByRole("button", { name: "Pakai lokasi saat ini" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ action: "turn", kind: "locate", lat: "5.14705", lon: "97.0482", accuracy: "12" });
    await screen.findByRole("button", { name: "Membaca lokasi..." });
  });

  test("a refusal, no fix and no geolocation each say what to do, and search stays", async () => {
    stubGeolocation({ code: 1 });
    draw(SAMPLE_DRAFTS.placeSearch);
    fireEvent.click(await screen.findByRole("button", { name: "Pakai lokasi saat ini" }));
    await screen.findByText(/Izin lokasi ditolak/);
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeTruthy();
    expect(screen.getByLabelText("Cari tempat")).toBeTruthy();

    stubGeolocation({ code: 2 }, { code: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByText(/Lokasi belum terbaca/);
    expect(screen.getByRole("button", { name: "Pakai lokasi saat ini" })).toBeTruthy();

    vi.stubGlobal("navigator", { ...navigator, geolocation: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Pakai lokasi saat ini" }));
    await screen.findByText(/Peramban ini tidak bisa membaca lokasi/);
  });

  test("the reading shows its village, coordinates to 6 decimals and accuracy, with Benar and Bukan", async () => {
    const { posts, action } = recording();
    draw(SAMPLE_DRAFTS.placeConfirm, { action });
    await screen.findByRole("heading", { name: "Lokasi terbaca" });
    expect(screen.getByText("Desa/Kel. Sukamaju")).toBeTruthy();
    expect(screen.getByText("Kec. Contoh, Aceh Utara, Aceh")).toBeTruthy();
    expect(screen.getByText("Titik 5.100000, 97.100000")).toBeTruthy();
    expect(screen.getByText("Titik GPS, ketelitian ±12 m")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Benar" }));
    await waitFor(() => expect(posts[0]).toMatchObject({ optionIds: "confirm" }));
    await screen.findByRole("button", { name: "Menyimpan jawaban..." });
  });

  test("an estimate says so, and the nearby list shows each village with its km and a way to read again", async () => {
    const reading = SAMPLE_DRAFTS.placeConfirm.card as Extract<Card, { kind: "placeConfirm" }>;
    draw({ ...SAMPLE_DRAFTS.placeConfirm, card: { ...reading, precision: "estimate" } });
    await screen.findByText(/Perkiraan, GPS kurang teliti/);
    cleanup();

    const { posts, action } = recording();
    const nearby = {
      ...reading,
      titleKey: "card.placeConfirm.nearbyTitle",
      promptKey: "card.placeConfirm.nearbyPrompt",
      options: [],
      nearby: [
        {
          code: "11.08.01.2002",
          villageName: "Mekar",
          districtName: "Contoh",
          regencyName: "Aceh Utara",
          provinceName: "Aceh",
          km: 0.8,
        },
        {
          code: "11.08.01.2003",
          villageName: "Jaya",
          districtName: "Contoh",
          regencyName: "Aceh Utara",
          provinceName: "Aceh",
          km: 1.4,
        },
      ],
    };
    draw({ ...SAMPLE_DRAFTS.placeConfirm, card: nearby }, { action });
    await screen.findByRole("heading", { name: "Pilih desa/kelurahan lokasi kejadian" });
    expect(screen.getByText("Kec. Contoh, 0,8 km dari titik Anda")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Benar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Bagikan lokasi ulang" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Jaya/ }));
    await waitFor(() => expect(posts[0]).toMatchObject({ villageCode: "11.08.01.2003" }));
    // A second tap while it is on its way sends nothing more.
    fireEvent.click(await screen.findByRole("button", { name: /Menyimpan jawaban/ }));
    expect(posts).toHaveLength(1);
  });

  test("with no script there is no GPS button and the photo form keeps its own send button", () => {
    expect(serverHtml(SAMPLE_DRAFTS.placeSearch)).not.toContain("Pakai lokasi saat ini");
    const photos = serverHtml(SAMPLE_DRAFTS.photos);
    expect(photos).toContain("Kirim foto");
    expect(photos).toContain('encType="multipart/form-data"');
    expect(photos).toContain('capture="environment"');
  });
});
