import { describe, expect, test } from "vitest";
import { text } from "../testing/render";
import { boundsOf, type MapPoint, markerElement, popupElement, STATUS_GROUPS } from "./deskMap";

const POINT: MapPoint = {
  ticketNumber: "LA-241126-01",
  status: "seen",
  hazardType: "flood",
  villageName: "Sukamaju",
  precision: "villageLevel",
  lat: 5.1,
  lon: 97.1,
};

describe("desk map pieces", () => {
  test("the box around the points, and none without points", () => {
    expect(boundsOf([POINT, { ...POINT, lat: -8.2, lon: 131.5 }, { ...POINT, lat: -2, lon: 110 }])).toEqual([
      [97.1, -8.2],
      [131.5, 5.1],
    ]);
    expect(boundsOf([])).toBeNull();
  });

  test("every status belongs to one of three groups", () => {
    expect(STATUS_GROUPS).toEqual({
      new: "open",
      seen: "open",
      under_review: "working",
      forwarded: "working",
      in_handling: "working",
      closed: "done",
      invalid: "done",
    });
  });

  test("a marker is a named button with its hazard's icon and its status group", () => {
    const marker = markerElement(POINT, text);
    expect(marker.tagName).toBe("BUTTON");
    expect(marker.type).toBe("button");
    expect(marker.className).toBe("desk-marker desk-marker-open");
    expect(marker.getAttribute("aria-label")).toBe("LA-241126-01, Banjir, Dilihat");
    const svg = marker.querySelector("svg") as SVGSVGElement;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(markerElement({ ...POINT, status: "closed", hazardType: "earthquake" }, text).className).toContain(
      "desk-marker-done",
    );
  });

  test("a popup holds the ticket, type and status, the village with its precision, and the way to the report", () => {
    const popup = popupElement({ ...POINT, villageName: "<b>Sukamaju</b>" }, text);
    expect([...popup.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
      "LA-241126-01",
      "Banjir, Dilihat",
      "<b>Sukamaju</b>, perkiraan tingkat desa",
    ]);
    expect(popup.querySelector("b")).toBeNull();
    const link = popup.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/lapor/meja/LA-241126-01");
    expect(link.textContent).toBe("Buka laporan");
  });
});
