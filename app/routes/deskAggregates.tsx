import { downloadAggregates } from "../lib/deskPage.server";
import type { Route } from "./+types/deskAggregates";

// The weekly counts as a file, not a page: posted, as each download is logged.
export const action = async ({ context }: Route.ActionArgs) => downloadAggregates(context.api);
