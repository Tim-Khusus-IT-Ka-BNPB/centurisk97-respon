import type { DeskGallery, DeskMap, DeskQueue } from "../../src/contract/desk";

// The desk's views, the one it opens on first, and the queue's filters as the address carries them, so a filtered view can be
// linked and reloaded. Shared by the page module and the screens.
export const DESK_VIEWS = ["map", "list", "gallery"] as const;
export type DeskView = (typeof DESK_VIEWS)[number];

export type DeskShown =
  | { readonly view: "list"; readonly queue: DeskQueue }
  // The map lists the newest of its reports beside it.
  | { readonly view: "map"; readonly map: DeskMap; readonly queue: DeskQueue }
  | { readonly view: "gallery"; readonly gallery: DeskGallery };

// What a refused change held, typed by the officer.
export type DeskTyped = {
  readonly values: Readonly<Record<string, string>>;
  readonly actions: readonly string[];
};

export type DeskFilters = {
  readonly view: DeskView;
  readonly status: string;
  readonly hazardType: string;
  readonly period: string;
  readonly ticket: string;
  readonly has: string;
  readonly page: number;
};

// A BPBD officer's full number, opened from a report.
export type OfficerNumber = { readonly profileId: string; readonly number: string };
