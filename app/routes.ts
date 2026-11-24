import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  route("lapor", "routes/home.tsx"),
  route("lapor/report", "routes/start.tsx"),
  route("lapor/report/:draftId", "routes/draft.tsx"),
  route("lapor/help", "routes/help.tsx"),
  route("lapor/about", "routes/about.tsx"),
  route("lapor/privacy", "routes/privacy.tsx"),
  route("*", "routes/notFound.tsx"),
] satisfies RouteConfig;
