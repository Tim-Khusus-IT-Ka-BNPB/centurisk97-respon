import { loadOwnDocument } from "../lib/ownReportPage.server";
import type { Route } from "./+types/ownDocument";

// A file, not a page.
export const loader = ({ params, context }: Route.LoaderArgs) =>
  loadOwnDocument(params.ticketNumber, params.file, context.api);
