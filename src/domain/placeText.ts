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

// A place word in the new spelling, from the old one still typed (Soerabaja, Djakarta, Tjilatjap,
// Jogjakarta): dj, tj, nj, sj and oe first, then the old j that is now y.
export function modernSpelling(word: string): string {
  return word
    .replaceAll("dj", "\u0001")
    .replaceAll("tj", "c")
    .replaceAll("nj", "ny")
    .replaceAll("sj", "sy")
    .replaceAll("oe", "u")
    .replaceAll("ch", "kh")
    .replaceAll("j", "y")
    .replaceAll("\u0001", "j");
}

// A word of 4 to 20 letters, close enough when the exact one finds nothing: itself in its new
// spelling, each letter left out, each letter any letter, and a letter more anywhere. "_" stands for
// any one letter, as LIKE reads it.
export function nearWords(word: string): readonly string[] {
  if (word.length < 4 || word.length > 20) return [word];
  const near = new Set([word, modernSpelling(word)]);
  for (let at = 0; at < word.length; at++) {
    near.add(word.slice(0, at) + word.slice(at + 1));
    near.add(`${word.slice(0, at)}_${word.slice(at + 1)}`);
  }
  for (let at = 0; at <= word.length; at++) near.add(`${word.slice(0, at)}_${word.slice(at)}`);
  return [...near];
}
