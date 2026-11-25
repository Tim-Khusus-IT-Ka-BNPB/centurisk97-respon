import { redirect } from "react-router";
import { safeReturn } from "../lib/theme";
import type { Route } from "./+types/theme";

// POST /lapor/theme: the theme switch's form. The route keeps the choice in a cookie; the page the
// person was on is drawn again in the new theme. Works with no script.
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const response = await context.api("POST", "/preferences/theme", { theme: form.get("theme") });
  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return redirect(safeReturn(form.get("back")), { status: 303, headers });
}
