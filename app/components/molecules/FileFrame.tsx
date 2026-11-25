import { useNavigate } from "react-router";
import { useHydrated } from "../../lib/hooks";
import { useText } from "../../lib/text";

const FILE_FRAME = "file";

// Where a file is fetched once the page runs script. The page itself then never starts a
// navigation for a download, which Safari answers by stopping every load still in flight and
// leaving the page half refreshed. Without script the file comes as before.
export const useFileTarget = () => (useHydrated() ? FILE_FRAME : undefined);

// A refused file comes back as its page with the notice, so the page is shown where the reader is
// and the frame is emptied for the next file.
export function FileFrame() {
  const t = useText();
  const navigate = useNavigate();
  return (
    <iframe
      name={FILE_FRAME}
      title={t("version.frame")}
      hidden
      onLoad={(event) => {
        const frame = event.currentTarget.contentWindow;
        if (frame === null || frame.location.href === "about:blank") return;
        const landed = new URL(frame.location.href);
        frame.location.replace("about:blank");
        navigate(`${landed.pathname}${landed.search}`);
      }}
    />
  );
}
