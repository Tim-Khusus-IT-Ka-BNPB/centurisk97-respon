// Photos on the home's tiles, from Wikimedia Commons by way of upstream's credits file. Each is cut
// and made smaller for the page, which its licence allows when the author, the licence and the source
// are named: on its tile and in full on the About page.
type Licence = "CC BY 4.0" | "CC BY-SA 4.0" | "publicDomain";

export type Photo = {
  readonly id: "cyclone" | "flood" | "firefighter";
  readonly file: string;
  readonly author: string;
  readonly licence: Licence;
  readonly source: string;
};

export const PHOTOS: readonly Photo[] = [
  {
    id: "cyclone",
    file: "cyclone-seroja",
    author: "NASA, LANCE / MODIS on Aqua",
    licence: "publicDomain",
    source: "https://commons.wikimedia.org/wiki/File:Seroja_2021-04-05_0545Z.jpg",
  },
  {
    id: "flood",
    file: "flooded-houses",
    author: "Sandy Syafrudin Nina",
    licence: "CC BY 4.0",
    source:
      "https://commons.wikimedia.org/wiki/File:Rumah-rumah_warga_masih_terendam_air_paska_banjir_bandang_Gorontalo_2024.jpg",
  },
  {
    id: "firefighter",
    file: "peat-firefighter",
    author: "DenY Krisbiyantoro",
    licence: "CC BY-SA 4.0",
    source: "https://commons.wikimedia.org/wiki/File:Marking_the_Fire.jpg",
  },
];

const LICENCE_PAGES: Readonly<Record<Exclude<Licence, "publicDomain">, string>> = {
  "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
};

// The licence's own page, or none for a photo in the public domain.
export const licencePage = (photo: Photo): string | null =>
  photo.licence === "publicDomain" ? null : LICENCE_PAGES[photo.licence];

export const photoOf = (id: Photo["id"]): Photo => PHOTOS.find((photo) => photo.id === id) as Photo;

export const photoSrcSet = (photo: Photo): string =>
  `/photos/${photo.file}-480.webp 480w, /photos/${photo.file}-960.webp 960w`;
