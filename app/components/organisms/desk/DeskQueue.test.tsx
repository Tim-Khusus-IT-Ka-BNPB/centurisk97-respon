import { screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { envelope } from "../../../../src/api/envelope";
import { FILTERS, ITEM, list, queue, renderDesk, SENT, SUMMARY } from "../../../testing/desk";

vi.mock("../DeskMapCanvas", () => ({
  DeskMapCanvas: ({ label }: { label: string }) => <section aria-label={label} />,
}));

import { DeskQueueView } from "./DeskQueue";

const PHOTO = {
  photoId: "11111111-1111-4111-8111-111111111111",
  ticketNumber: "LA-241126-01",
  badge: "deviceGps" as const,
  far: true,
  takenAt: SENT,
  receivedAt: SENT,
};

const POINT = {
  ticketNumber: "LA-241126-01",
  status: "seen" as const,
  hazardType: "flood",
  villageName: "Sukamaju",
  precision: "villageLevel" as const,
  emergency: false,
  lat: 5.1,
  lon: 97.123456,
};

const table = () => within(screen.getByRole("table"));

describe("the side menu", () => {
  test("names the account, links each view and status queue with its count, and marks the one in use", async () => {
    await renderDesk(
      <DeskQueueView
        shown={list(queue())}
        summary={SUMMARY}
        filters={{ ...FILTERS, status: "under_review" }}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    const menus = screen.getAllByRole("navigation", { name: "Antrean kerja" });
    // One menu beside the work, one behind the phone's menu button.
    expect(menus).toHaveLength(2);
    const queues = within(menus[0] as HTMLElement);
    expect(queues.getByRole("link", { name: "Semua laporan, 9 laporan" }).getAttribute("href")).toBe(
      "/lapor/meja?view=list",
    );
    const current = queues.getByRole("link", { name: "Ditelaah, 2 laporan" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.getAttribute("href")).toBe("/lapor/meja?view=list&status=under_review");
    expect(queues.getByRole("link", { name: "Diteruskan, 0 laporan" })).toBeTruthy();
    const views = within(screen.getAllByRole("navigation", { name: "Tampilan" })[0] as HTMLElement);
    expect(views.getByRole("link", { name: "Daftar laporan" }).getAttribute("aria-current")).toBe("page");
    expect(views.getByRole("link", { name: "Peta laporan" }).getAttribute("href")).toBe(
      "/lapor/meja?status=under_review",
    );
    expect(screen.getAllByText("Masuk sebagai Pusdalops BNPB, Petugas Uji")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Keluar" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Form lapor warga" })[0]?.getAttribute("href")).toBe("/lapor");
    expect(screen.getByText("Antrean Ditelaah")).toBeTruthy();
  });

  test("with no counts the menu still leads everywhere", async () => {
    await renderDesk(<DeskQueueView shown={list(queue())} summary={null} filters={FILTERS} envelope={null} />, {
      path: "/lapor/meja",
    });
    const queues = within(screen.getAllByRole("navigation", { name: "Antrean kerja" })[0] as HTMLElement);
    expect(queues.getByRole("link", { name: "Semua laporan" }).getAttribute("aria-current")).toBe("page");
    expect(queues.getByRole("link", { name: "Diterima" })).toBeTruthy();
    // The hazard chips list every type when their counts are unknown.
    const chips = within(screen.getByRole("navigation", { name: "Jenis bencana" }));
    expect(chips.getAllByRole("link")).toHaveLength(11);
    // The account's name comes from the view when the counts are missing.
    expect(screen.getAllByText("Masuk sebagai Pusdalops BNPB, Petugas Uji")).toHaveLength(2);
  });
});

describe("the filter bar", () => {
  test("hazard chips carry their counts and toggle; the period links; the search keeps the other filters", async () => {
    await renderDesk(
      <DeskQueueView
        shown={list(queue())}
        summary={SUMMARY}
        filters={{ ...FILTERS, hazardType: "landslide", period: "week" }}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    const chips = within(screen.getByRole("navigation", { name: "Jenis bencana" }));
    expect(chips.getByRole("link", { name: "Semua jenis, 9 laporan" }).getAttribute("href")).toBe(
      "/lapor/meja?view=list&period=week",
    );
    expect(chips.getByRole("link", { name: "Banjir, 7 laporan" }).getAttribute("href")).toBe(
      "/lapor/meja?view=list&hazardType=flood&period=week",
    );
    const picked = chips.getByRole("link", { name: "Tanah longsor, 2 laporan" });
    expect(picked.getAttribute("aria-current")).toBe("true");
    expect(picked.getAttribute("href")).toBe("/lapor/meja?view=list&period=week");
    // Types with no reports are left out.
    expect(chips.queryByRole("link", { name: /Gempa/ })).toBeNull();
    const period = within(screen.getByRole("navigation", { name: "Periode" }));
    expect(period.getByRole("link", { name: "7 hari" }).getAttribute("aria-current")).toBe("true");
    expect(period.getByRole("link", { name: "Semua" }).getAttribute("href")).toBe(
      "/lapor/meja?view=list&hazardType=landslide",
    );
    const hidden = [...document.querySelectorAll('form[role="search"] input[type="hidden"]')].map((input) => [
      input.getAttribute("name"),
      input.getAttribute("value"),
    ]);
    expect(hidden).toEqual([
      ["view", "list"],
      ["hazardType", "landslide"],
      ["period", "week"],
    ]);
    expect(screen.getByRole("link", { name: "Hapus saringan" }).getAttribute("href")).toBe("/lapor/meja?view=list");
  });

  test("what the reports hold: chips with counts that toggle", async () => {
    await renderDesk(
      <DeskQueueView
        shown={list(queue())}
        summary={SUMMARY}
        filters={{ ...FILTERS, has: "victims" }}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    const holds = within(screen.getByRole("navigation", { name: "Isi laporan" }));
    const victims = holds.getByRole("link", { name: "Ada korban, 3 laporan" });
    expect(victims.getAttribute("aria-current")).toBe("true");
    expect(victims.getAttribute("href")).toBe("/lapor/meja?view=list");
    expect(holds.getByRole("link", { name: "Ada foto, 0 laporan" }).getAttribute("href")).toBe(
      "/lapor/meja?view=list&has=photos",
    );
    const kept = [...document.querySelectorAll('form[role="search"] input[name="has"]')];
    expect(kept.map((input) => input.getAttribute("value"))).toEqual(["victims"]);
    expect(screen.getByRole("link", { name: "Hapus saringan" })).toBeTruthy();
  });

  test("a hazard picked with no reports left still shows, at 0; no filters, no clear link", async () => {
    await renderDesk(
      <DeskQueueView
        shown={list(queue())}
        summary={{ ...SUMMARY, byHazard: {} }}
        filters={{ ...FILTERS, hazardType: "drought" }}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.getByRole("link", { name: "Kekeringan, 0 laporan" })).toBeTruthy();
  });

  test("a refused search keeps its text, names the fix and draws no list", async () => {
    const refused = {
      ...envelope("request.invalidFields"),
      fields: [{ fieldId: "ticket", copyKey: "fieldError.ticketNumber.format", params: {} }],
    };
    await renderDesk(
      <DeskQueueView shown={null} summary={null} filters={{ ...FILTERS, ticket: "0800" }} envelope={refused} />,
      { path: "/lapor/meja" },
    );
    expect(
      screen.getByText("Nomor tiket ditulis seperti LA-241126-01. Periksa lagi nomornya, lalu cari."),
    ).toBeTruthy();
    const field = screen.getByLabelText("Nomor tiket") as HTMLInputElement;
    expect(field.value).toBe("0800");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("link", { name: "Hapus saringan" })).toBeTruthy();
  });

  test("no filter in use leaves no clear link", async () => {
    await renderDesk(<DeskQueueView shown={list(queue())} summary={SUMMARY} filters={FILTERS} envelope={null} />, {
      path: "/lapor/meja",
    });
    expect(screen.queryByRole("link", { name: "Hapus saringan" })).toBeNull();
    expect(screen.getByText("2 laporan")).toBeTruthy();
  });
});

describe("the list", () => {
  test("a table row: ticket and status, the event and place, each figure, times, reporter and how complete", async () => {
    await renderDesk(<DeskQueueView shown={list(queue())} summary={SUMMARY} filters={FILTERS} envelope={null} />, {
      path: "/lapor/meja",
    });
    expect(
      table()
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Tiket", "Kejadian", "Korban", "Rumah rusak", "Dilaporkan", "Pelapor", "Isian"]);
    const [first, second] = table().getAllByRole("row").slice(1) as HTMLElement[];
    const row = within(first as HTMLElement);
    expect(row.getByRole("link", { name: "LA-241126-01" }).getAttribute("href")).toBe("/lapor/meja/LA-241126-01");
    expect(row.getByText("Diterima")).toBeTruthy();
    expect(row.getByText("Banjir")).toBeTruthy();
    expect(row.getByText("Tidak tahu")).toBeTruthy();
    expect(row.getByText("Sukamaju, Aceh Utara")).toBeTruthy();
    expect(row.getByText("Meninggal: 2 orang")).toBeTruthy();
    expect(row.getByText("Hilang: belum didata")).toBeTruthy();
    expect(row.getByText("Luka-luka: tidak ada")).toBeTruthy();
    expect(row.getByText("Rumah rusak: 3 rumah, Sebagian jenis kerusakan belum didata")).toBeTruthy();
    expect(row.getByText("3+")).toBeTruthy();
    expect(row.getByText("24 Nov 2026, 09.30 WIB")).toBeTruthy();
    expect(row.getByText("Kejadian: 24 Nov 2026")).toBeTruthy();
    expect(row.getByText("Nomor belum diverifikasi")).toBeTruthy();
    expect(row.getByText("62% lengkap")).toBeTruthy();
    expect(row.getByText("2 foto")).toBeTruthy();
    const other = within(second as HTMLElement);
    expect(other.getByText("Kejadian: Sudah lebih dari 30 hari")).toBeTruthy();
    expect(other.getByText("Petugas BPBD (belum dikonfirmasi)")).toBeTruthy();
    expect(other.queryByText("Nomor belum diverifikasi")).toBeNull();
  });

  test("an emergency is marked, with what was told of victims; one tap told no hazard", async () => {
    const told = { ...ITEM, emergency: { kind: "chat" as const, victims: "yes" as const } };
    const tapped = {
      ...ITEM,
      ticketNumber: "LA-241126-02",
      hazardType: "other" as const,
      emergency: { kind: "oneTap" as const, victims: "unknown" as const },
    };
    await renderDesk(
      <DeskQueueView
        shown={list(queue({ items: [told, tapped] }))}
        summary={SUMMARY}
        filters={FILTERS}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    const [first, second] = table().getAllByRole("row").slice(1) as HTMLElement[];
    expect(within(first as HTMLElement).getByText("Darurat")).toBeTruthy();
    expect(within(first as HTMLElement).getByText("ada korban")).toBeTruthy();
    expect(within(second as HTMLElement).getByText("Jenis belum diketahui")).toBeTruthy();
    expect(screen.getAllByText("Darurat")).toHaveLength(4);
  });

  test("a report in an officer's hand names them, in the table and on the card", async () => {
    await renderDesk(
      <DeskQueueView
        shown={list(queue({ items: [{ ...ITEM, taker: "Uji Andi, Pusdalops BPBD Kabupaten Uji Satu" }], total: 1 }))}
        summary={{ ...SUMMARY, mayReadResponse: false }}
        filters={FILTERS}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.getAllByText("Ditangani: Uji Andi, Pusdalops BPBD Kabupaten Uji Satu")).toHaveLength(2);
    // Only an account that may read them is led to the response figures.
    expect(screen.queryByRole("link", { name: "Respons BPBD" })).toBeNull();
  });

  test("a reporter's name this account must ask for is left out of both", async () => {
    const asked = { ...ITEM, reporter: { name: null, role: "citizen" as const } };
    await renderDesk(
      <DeskQueueView
        shown={list(queue({ items: [asked], total: 1 }))}
        summary={SUMMARY}
        filters={FILTERS}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.queryByText("Uji Satu")).toBeNull();
    expect(screen.getAllByText("Warga")).toHaveLength(2);
  });

  test("a known hour of the event shows with its zone; a phone gets the same reports as cards", async () => {
    const timed = {
      ...ITEM,
      eventTime: { kind: "dateTime" as const, localDate: "2026-11-24", localTime: "08:15", zone: "WIB" as const },
    };
    await renderDesk(
      <DeskQueueView
        shown={list(queue({ items: [timed], total: 1 }))}
        summary={SUMMARY}
        filters={FILTERS}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(table().getByText("Kejadian: 24 Nov 2026, 08.15 WIB")).toBeTruthy();
    const cards = screen.getAllByRole("listitem").filter((item) => item.closest("ul")?.className.includes("xl:hidden"));
    expect(cards).toHaveLength(1);
    const card = within(cards[0] as HTMLElement);
    expect(card.getByRole("link").getAttribute("href")).toBe("/lapor/meja/LA-241126-01");
    expect(card.getByText("Meninggal: 2 orang")).toBeTruthy();
    expect(card.getByText("Nomor belum diverifikasi")).toBeTruthy();
  });

  test("an empty queue says so; pages link to their neighbours with the filters kept", async () => {
    const view = await renderDesk(
      <DeskQueueView
        shown={list(queue({ items: [], total: 0 }))}
        summary={SUMMARY}
        filters={FILTERS}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.getByText("Belum ada laporan yang cocok dengan saringan ini.")).toBeTruthy();
    view.unmount();
    await renderDesk(
      <DeskQueueView
        shown={list(queue({ page: 2, pageCount: 3, total: 120 }))}
        summary={SUMMARY}
        filters={{ ...FILTERS, status: "seen", page: 2 }}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.getByRole("link", { name: "Halaman sebelumnya" }).getAttribute("href")).toBe(
      "/lapor/meja?view=list&status=seen",
    );
    expect(screen.getByRole("link", { name: "Halaman berikutnya" }).getAttribute("href")).toBe(
      "/lapor/meja?view=list&status=seen&page=3",
    );
  });

  test("the first and last pages link one way only", async () => {
    const view = await renderDesk(
      <DeskQueueView
        shown={list(queue({ page: 1, pageCount: 2 }))}
        summary={SUMMARY}
        filters={FILTERS}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.queryByRole("link", { name: "Halaman sebelumnya" })).toBeNull();
    view.unmount();
    await renderDesk(
      <DeskQueueView
        shown={list(queue({ page: 2, pageCount: 2 }))}
        summary={SUMMARY}
        filters={{ ...FILTERS, page: 2 }}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.queryByRole("link", { name: "Halaman berikutnya" })).toBeNull();
  });
});

describe("the map and the gallery", () => {
  test("the map view fills the window beside the menu; a gallery within its limit carries no notice", async () => {
    const view = await renderDesk(
      <DeskQueueView
        shown={{
          view: "map",
          map: { account: { label: "Petugas Uji" }, points: [POINT], cut: false },
          queue: queue({ account: { label: "Petugas Uji" } }),
        }}
        summary={null}
        filters={{ ...FILTERS, view: "map" }}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.getByRole("heading", { level: 1, name: "Peta laporan" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Peta laporan" })).toBeTruthy();
    expect(screen.getByRole("main").parentElement?.className).toContain("lg:h-dvh");
    expect(screen.getAllByText("Masuk sebagai Petugas Uji")).toHaveLength(2);
    const tabs = within(screen.getByRole("navigation", { name: "Tampilan laporan" }));
    expect(tabs.getByRole("link", { name: "Peta" }).getAttribute("aria-current")).toBe("true");
    view.unmount();
    await renderDesk(
      <DeskQueueView
        shown={{ view: "gallery", gallery: { account: { label: "Petugas Galeri" }, photos: [PHOTO], cut: false } }}
        summary={null}
        filters={{ ...FILTERS, view: "gallery" }}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.queryByText(/Galeri menampilkan/)).toBeNull();
    expect(screen.getAllByText("Masuk sebagai Petugas Galeri")).toHaveLength(2);
  });

  test("a refused search on the map keeps the map and the field, with no list", async () => {
    await renderDesk(
      <DeskQueueView
        shown={null}
        summary={null}
        filters={{ ...FILTERS, view: "map", ticket: "0800" }}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.getByRole("region", { name: "Peta laporan" })).toBeTruthy();
    expect((screen.getByLabelText("Nomor tiket") as HTMLInputElement).value).toBe("0800");
    expect(screen.queryByText(/laporan$/, { selector: "p" })).toBeNull();
  });

  test("the gallery: each photo with its report, badges and time, and a notice when cut", async () => {
    const gallery = {
      account: { label: "Petugas Uji" },
      photos: [PHOTO, { ...PHOTO, photoId: "2", badge: "none" as const, far: false }],
      cut: true,
    };
    await renderDesk(
      <DeskQueueView
        shown={{ view: "gallery", gallery }}
        summary={SUMMARY}
        filters={{ ...FILTERS, view: "gallery" }}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.getByText("2 foto")).toBeTruthy();
    expect(screen.getByText(/Galeri menampilkan 2 foto terbaru/)).toBeTruthy();
    expect(screen.getAllByRole("img", { name: "Foto laporan LA-241126-01" })[0]?.getAttribute("src")).toBe(
      `/api/lapor/desk/photos/${PHOTO.photoId}`,
    );
    expect(screen.getByText("Lokasi GPS perangkat")).toBeTruthy();
    expect(screen.getByText("Tanpa lokasi")).toBeTruthy();
    expect(screen.getAllByText("Jauh dari lokasi kejadian")).toHaveLength(1);
  });

  test("an empty gallery says so", async () => {
    await renderDesk(
      <DeskQueueView
        shown={{ view: "gallery", gallery: { account: { label: "Petugas Uji" }, photos: [], cut: false } }}
        summary={SUMMARY}
        filters={{ ...FILTERS, view: "gallery" }}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.getByText("Belum ada foto untuk saringan ini.")).toBeTruthy();
  });
});
