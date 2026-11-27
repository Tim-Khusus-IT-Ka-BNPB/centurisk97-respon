import { fireEvent, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useLocation } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { renderPage } from "../../testing/render";
import { FileFrame, useFileTarget } from "./FileFrame";

const PATH = "/reports/LA-231126-01";

function Page() {
  return (
    <>
      <a href="/x.pdf" target={useFileTarget()}>
        Unduh
      </a>
      <p>{useLocation().search}</p>
      <FileFrame />
    </>
  );
}

const Target = () => <p>{useFileTarget() ?? "none"}</p>;

async function frame(contentWindow?: unknown) {
  renderPage(<Page />, { path: PATH });
  const found = (await screen.findByTitle("Unduhan berkas")) as HTMLIFrameElement;
  if (contentWindow !== undefined) Object.defineProperty(found, "contentWindow", { value: contentWindow });
  return found;
}

describe("the frame files come into", () => {
  test("a file goes to the hidden frame, so the page never navigates for it", async () => {
    const found = await frame();
    expect(found.hidden).toBe(true);
    expect(screen.getByRole("link", { name: "Unduh" }).getAttribute("target")).toBe(found.name);
  });

  test("with no script it comes as it always did", () => {
    expect(renderToString(<Target />)).toBe("<p>none</p>");
  });

  test.each([
    ["empty", undefined],
    ["gone", null],
  ])("a frame that is %s leads nowhere", async (_, contentWindow) => {
    fireEvent.load(await frame(contentWindow));
    expect(screen.queryByText("?refused=document")).toBeNull();
  });

  test("a refused file shows its page where the reader is, and the frame is emptied", async () => {
    const replace = vi.fn();
    const href = `http://localhost${PATH}?refused=document`;
    fireEvent.load(await frame({ location: { href, replace } }));
    expect(await screen.findByText("?refused=document")).toBeTruthy();
    expect(replace).toHaveBeenCalledWith("about:blank");
  });
});
