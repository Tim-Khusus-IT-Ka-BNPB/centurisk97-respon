import { redirect } from "react-router";

// The site's own root has no page: the service lives under /lapor, so the root leads there.
export const loader = () => redirect("/lapor", 302);
