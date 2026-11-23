// Place names are matched word by word on lower case letters and digits only.
export function placeSearchText(...parts: readonly string[]): string {
  return parts
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MAX_QUERY_WORDS = 5;

// The words of a place query that must all match: one letter words are ignored, five at most.
export function placeQueryWords(query: string): readonly string[] {
  return placeSearchText(query)
    .split(" ")
    .filter((word) => word.length > 1)
    .slice(0, MAX_QUERY_WORDS);
}
