import { makeText, type Texts } from "../../src/copy/text";

// The one share picture of every page, served from the static files.
const SHARE_IMAGE = { path: "/og/respon.png", width: "1200", height: "630", type: "image/png" } as const;

type MetaArgs = {
  readonly data: { readonly texts?: Texts } | undefined;
  readonly matches: readonly ({ readonly id: string; readonly data?: unknown } | undefined)[];
};

export type PageMetaKeys = {
  readonly title: string;
  readonly description: string;
  // The page's preferred address; a draft points at the start step so its own address never leaves.
  readonly path: string;
  // Only public pages are listed by search engines.
  readonly index?: boolean;
};

// The site's address from the root loader, which reads it from the setting.
const originOf = (matches: MetaArgs["matches"]) => {
  const root = matches.find((match) => match?.id === "root")?.data as { origin?: string } | undefined;
  return root?.origin ?? "";
};

// Title, description, canonical address, search directive and share card of a page, all from the catalogue.
export function pageMeta({ data, matches }: MetaArgs, keys: PageMetaKeys) {
  if (data?.texts === undefined) return [];
  const t = makeText(data.texts);
  const params = { appName: "app.name" };
  const title = t(keys.title, params);
  const description = t(keys.description, params);
  const origin = originOf(matches);
  const url = `${origin}${keys.path}`;
  const image = `${origin}${SHARE_IMAGE.path}`;
  const imageAlt = t("meta.image.alt", params);
  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { name: "robots", content: keys.index === false ? "noindex, nofollow" : "index, follow" },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: t("app.name") },
    { property: "og:locale", content: "id_ID" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:image", content: image },
    { property: "og:image:type", content: SHARE_IMAGE.type },
    { property: "og:image:width", content: SHARE_IMAGE.width },
    { property: "og:image:height", content: SHARE_IMAGE.height },
    { property: "og:image:alt", content: imageAlt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: imageAlt },
  ];
}
