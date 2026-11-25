import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  route("lapor", "routes/home.tsx"),
  route("lapor/report", "routes/start.tsx"),
  route("lapor/report/:draftId", "routes/draft.tsx"),
  route("lapor/lacak", "routes/tracking.tsx"),
  route("lapor/theme", "routes/theme.tsx"),
  route("lapor/meja", "routes/desk.tsx"),
  route("lapor/meja/:ticketNumber", "routes/deskReport.tsx"),
  route("lapor/help", "routes/help.tsx"),
  route("lapor/about", "routes/about.tsx"),
  route("lapor/privacy", "routes/privacy.tsx"),
  route("*", "routes/notFound.tsx"),
] satisfies RouteConfig;
