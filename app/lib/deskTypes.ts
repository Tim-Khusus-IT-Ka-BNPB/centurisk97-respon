import type { DeskGallery, DeskMap, DeskQueue } from "../../src/contract/desk";

// The desk's views and the queue's filters as the address carries them, so a filtered view can be
// linked and reloaded. Shared by the page module and the screens.
export const DESK_VIEWS = ["list", "map", "gallery"] as const;
export type DeskView = (typeof DESK_VIEWS)[number];

export type DeskShown =
  | { readonly view: "list"; readonly queue: DeskQueue }
  | { readonly view: "map"; readonly map: DeskMap }
  | { readonly view: "gallery"; readonly gallery: DeskGallery };

export type DeskFilters = {
  readonly view: DeskView;
  readonly status: string;
  readonly hazardType: string;
  readonly period: string;
  readonly ticket: string;
  readonly page: number;
};
