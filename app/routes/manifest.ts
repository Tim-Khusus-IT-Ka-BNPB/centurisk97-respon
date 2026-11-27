import { copy } from "../../src/copy";

// The app as a phone installs it (K29): its name, icons and the ways in from the home screen.
const NAVY = "#0b2545";

export const loader = () =>
  Response.json(
    {
      name: copy.text("app.name"),
      short_name: copy.text("install.shortName"),
      description: copy.text("install.description"),
      lang: "id",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: NAVY,
      theme_color: NAVY,
      icons: [
        { src: "/icons/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
      shortcuts: [
        { name: copy.text("install.report"), url: "/report" },
        { name: copy.text("install.emergency"), url: "/report?emergency=1" },
        { name: copy.text("install.feed"), url: "/feed" },
      ].map((shortcut) => ({ ...shortcut, icons: [{ src: "/icons/192.png", sizes: "192x192" }] })),
    },
    { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } },
  );
