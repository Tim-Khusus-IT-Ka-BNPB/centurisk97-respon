import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Card } from "../../../../src/contract/card";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { cameraJpeg } from "../../../../src/testing/photoBase";
import { SAMPLE_DRAFTS } from "../../../../src/testing/samples";
import { renderDraft } from "../../../testing/render";
import { CardView } from "../CardView";

// The test browser cannot post a real file through the router, so the submit is caught here,
// and the page can be shown as if a photo were on its way.
const router = vi.hoisted(() => ({
  submitted: [] as Record<string, FormDataEntryValue>[],
  options: [] as unknown[],
  sending: false,
}));
vi.mock("react-router", async (importOriginal) => {
  const real = await importOriginal<typeof import("react-router")>();
  return {
    ...real,
    useSubmit: () => (form: FormData, options: unknown) => {
      router.submitted.push(Object.fromEntries(form));
      router.options.push(options);
    },
    useNavigation: () => {
      const navigation = real.useNavigation();
      if (!router.sending) return navigation;
      const formData = new FormData();
      formData.set("action", "photo");
      return { ...navigation, state: "submitting", formData };
    },
  };
});

type PhotosCard = Extract<Card, { kind: "photos" }>;
const card = SAMPLE_DRAFTS.photos.card as PhotosCard;
const draw = (photos: Partial<PhotosCard> = {}, options: Parameters<typeof renderDraft>[2] = {}) => {
  const draft = { ...SAMPLE_DRAFTS.photos, card: { ...card, ...photos } };
  return renderDraft(<CardView card={draft.card} />, draft, options);
};
const photoFile = (lastModified = Date.now()) =>
  new File([new Uint8Array(cameraJpeg({ make: "Uji" }))], "foto.jpg", { type: "image/jpeg", lastModified });

type Reading = { readonly lat: number };
function stubGeolocation(...readings: Reading[]) {
  vi.stubGlobal("navigator", {
    ...navigator,
    geolocation: {
      getCurrentPosition(ok: PositionCallback, fail: PositionErrorCallback) {
        const next = readings.shift();
        if (!next) fail({ code: 2 } as GeolocationPositionError);
        else
          ok({
            coords: { latitude: next.lat, longitude: 97.0482, accuracy: 12 },
            timestamp: Date.now(),
          } as GeolocationPosition);
      },
    },
  });
}

beforeEach(() => {
  router.submitted.length = 0;
  router.options.length = 0;
  router.sending = false;
});
afterEach(() => vi.unstubAllGlobals());

describe("photo card", () => {
  test("each photo shows its picture, badges, time with zone and source; the count and Lanjut follow", async () => {
    stubGeolocation();
    const first = card.photos[0] as PhotosCard["photos"][number];
    draw({ photos: [{ ...first, far: true }, ...card.photos.slice(1)] });
    await screen.findByRole("heading", { name: "Foto kejadian" });
    expect(screen.getByRole("img", { name: "Foto 1" }).getAttribute("src")).toBe(
      `/api/lapor/drafts/${SAMPLE_DRAFTS.photos.draftId}/photos/${first.photoId}`,
    );
    expect(screen.getByText("Lokasi GPS perangkat")).toBeTruthy();
    expect(screen.getByText("Jauh dari lokasi kejadian")).toBeTruthy();
    expect(screen.getByText("Tanpa lokasi")).toBeTruthy();
    expect(screen.getByText("09.58 WIB, waktu EXIF foto")).toBeTruthy();
    expect(screen.getByText("09.59 WIB, waktu unggah")).toBeTruthy();
    expect(screen.getByText("5.10000, 97.10000")).toBeTruthy();
    expect(screen.getByText("2 dari 10 foto")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lanjut" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kirim foto" })).toBeNull();
  });

  test("a photo just taken goes at once, shrunk, with the phone's reading and zone", async () => {
    stubGeolocation({ lat: 5.14705 });
    draw();
    const input = (await screen.findByLabelText("Ambil foto")) as HTMLInputElement;
    expect(input.getAttribute("accept")).toBe("image/jpeg");
    expect(input.getAttribute("capture")).toBe("environment");
    const file = photoFile();
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(router.submitted).toHaveLength(1));
    const sent = router.submitted[0] as Record<string, FormDataEntryValue>;
    expect(sent).toMatchObject({
      action: "photo",
      revision: String(SAMPLE_DRAFTS.photos.revision),
      lat: "5.14705",
      lon: "97.0482",
      accuracy: "12",
      offset: String(-new Date().getTimezoneOffset()),
    });
    expect((sent.photo as File).size).toBe(file.size);
    expect(router.options[0]).toMatchObject({ method: "post", encType: "multipart/form-data" });
  });

  test("a reading older than 9 minutes is read again first", async () => {
    stubGeolocation({ lat: 1 }, { lat: 5.14705 });
    draw();
    const input = (await screen.findByLabelText("Ambil foto")) as HTMLInputElement;
    // The first reading lands while the card is shown; the photo is taken 10 minutes later.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const later = Date.now() + 10 * 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    fireEvent.change(input, { target: { files: [photoFile(later)] } });
    await waitFor(() => expect(router.submitted[0]).toMatchObject({ lat: "5.14705", readAt: String(later) }));
    vi.restoreAllMocks();
  });

  test("with no reading at all the boxes go empty, and an empty pick sends nothing", async () => {
    stubGeolocation();
    draw();
    const input = (await screen.findByLabelText("Ambil foto")) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    fireEvent.change(input, { target: { files: [photoFile()] } });
    await waitFor(() => expect(router.submitted[0]).toMatchObject({ lat: "", lon: "", accuracy: "", readAt: "" }));
    expect(router.submitted).toHaveLength(1);
  });

  test("an old file and an unreadable one say why under the field and nothing goes", async () => {
    stubGeolocation();
    draw();
    const input = (await screen.findByLabelText("Ambil foto")) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [photoFile(Date.now() - 6 * 60_000)] } });
    await screen.findByText(/bukan rekaman baru/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("photo-error");
    const png = new File([new Uint8Array([0x89, 0x50])], "a.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [png] } });
    await screen.findByText(/Foto tidak terbaca/);
    expect(router.submitted).toHaveLength(0);
  });

  test("a refusal from the server shows under the field", async () => {
    stubGeolocation();
    const refused = {
      error: { code: "request.invalidFields", copyKey: "error.request.invalidFields", params: {} },
      fields: [{ fieldId: "photo", copyKey: "fieldError.photo.notCamera", params: {} }],
      retryAt: null,
      draft: null,
    } as ErrorEnvelope;
    draw({}, { envelope: refused });
    await screen.findByText(/Tangkapan layar dan gambar hasil sunting/);
  });

  test("while a photo is on its way the camera says so and takes no other", async () => {
    stubGeolocation();
    router.sending = true;
    draw();
    const input = (await screen.findByLabelText("Mengirim foto...")) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  test("with 10 photos the camera is gone and the card says so; with none, Tidak bisa mengirim foto", async () => {
    stubGeolocation();
    const one = card.photos[1] as PhotosCard["photos"][number];
    const ten = Array.from({ length: 10 }, (_, i) => ({ ...one, photoId: `p-${i}` }));
    const { unmount } = draw({ photos: ten });
    await screen.findByText(/Sudah 10 foto/);
    expect(screen.queryByLabelText("Ambil foto")).toBeNull();
    unmount();
    const none = {
      ...(card.options[0] as PhotosCard["options"][number]),
      id: "cannotSend",
      labelKey: "card.photos.cannotSend",
    };
    draw({ photos: [], params: { count: 0, max: 10 }, options: [none] });
    await screen.findByRole("button", { name: "Tidak bisa mengirim foto" });
  });
});
