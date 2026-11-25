import { downloadDeskDocument } from "../lib/deskPage.server";
import type { Route } from "./+types/deskDocument";

// A file, not a page: posted, as each download is logged.
export const action = async ({ params, request, context }: Route.ActionArgs) =>
  downloadDeskDocument(params.ticketNumber, await request.formData(), context.api);
