import type { ReactNode } from "react";

// "kabupaten/kota" may break after the slash rather than inside a word. The break is added where
// the text is drawn; the catalogue holds plain text only.
const AFTER_SLASH = /(?<=\p{L}\/)(?=\p{L})/u;

export function breakAfterSlash(text: string): ReactNode {
  const parts = text.split(AFTER_SLASH);
  if (parts.length === 1) return text;
  const nodes: ReactNode[] = [];
  let offset = 0;
  for (const part of parts) {
    if (offset > 0) nodes.push(<wbr key={offset} />);
    nodes.push(part);
    offset += part.length;
  }
  return nodes;
}
