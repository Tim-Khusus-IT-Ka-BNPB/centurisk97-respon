import { useNavigation } from "react-router";

// A thin line at the top while the next page is on its way. It waits a moment first, so a quick
// page shows nothing.
export function NavProgress() {
  const { state } = useNavigation();
  return state === "idle" ? null : <span aria-hidden="true" className="nav-progress" />;
}
