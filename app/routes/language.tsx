import { redirect } from "react-router";
import { safeReturn } from "../lib/theme";
import type { Route } from "./+types/language";

// POST /lapor/bahasa: the language picker's form. The route keeps the choice in a cookie; the page
// the reporter was on is drawn again in that language. Works with no script.
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const response = await context.api("POST", "/preferences/language", { language: form.get("language") });
  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return redirect(safeReturn(form.get("back")), { status: 303, headers });
}
