// One space between words, no control characters, compatibility forms folded.
export function tidy(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Lower case without emphasis marks and quote characters, for matching words.
export function folded(text: string): string {
  return tidy(text)
    .toLowerCase()
    .replace(/[*_~`"'‘’“”]/g, "");
}

// Letter and digit words of a text, case folded.
export function wordsOf(text: string): string[] {
  return folded(text)
    .split(/[^\p{L}\p{N}]/u)
    .filter((word) => word !== "");
}
