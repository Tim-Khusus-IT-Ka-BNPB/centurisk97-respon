import type { FieldId } from "./fields/catalogue";
import type { HazardTypeId } from "./hazards";
import type { MaskedText } from "./masking";
import { findNumbers } from "./numbers";
import { folded } from "./text";

// The words a reporter uses for each count. "mengungsi" after "keluarga" or "kk" counts families, not people.
const COUNT_WORDS: readonly (readonly [FieldId, string])[] = [
  ["displacedFamilies", "keluarga mengungsi|kk mengungsi"],
  ["affectedFamilies", "keluarga terdampak|kk terdampak"],
  ["affectedPeople", "warga terdampak|orang terdampak|jiwa terdampak"],
  ["injuredInpatient", "dirawat inap|rawat inap"],
  ["housesHeavy", "rusak berat"],
  ["housesModerate", "rusak sedang"],
  ["housesLight", "rusak ringan"],
  ["housesFlooded", "terendam"],
  ["healthFacilities", "fasilitas kesehatan|puskesmas"],
  ["worshipPlaces", "tempat ibadah|masjid|gereja"],
  ["dead", "meninggal|tewas|wafat|korban jiwa"],
  ["missing", "hilang"],
  ["injured", "luka-luka|luka|terluka"],
  ["displacedPeople", "(?<!keluarga |kk )(?:mengungsi|pengungsi)"],
  ["schools", "sekolah"],
  ["roads", "jalan|jembatan"],
];

const HAZARD_WORDS: readonly (readonly [HazardTypeId, RegExp])[] = [
  ["forestFire", /kebakaran hutan|karhutla|lahan terbakar|hutan terbakar/],
  ["buildingFire", /kebakaran (?:rumah|gedung|pasar|toko)|rumah terbakar/],
  ["flood", /banjir|genangan|\brob\b/],
  ["landslide", /longsor|tanah bergerak/],
  ["tidalWaveAbrasion", /abrasi|gelombang pasang/],
  ["extremeWeather", /puting beliung|angin kencang|cuaca ekstrem|hujan es/],
  ["drought", /kekeringan|kemarau/],
  ["earthquake", /gempa/],
  ["tsunami", /tsunami/],
  ["volcanicEruption", /erupsi|letusan|meletus|abu vulkanik/],
];

const WORD =
  "(?:nol|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|seribu|belas|puluh|ratus|ribu)";
const NUMBER = `(\\d[\\d.]*|${WORD}(?: ${WORD})*)`;
const UNIT = "(?:orang|jiwa|kk|keluarga|rumah|unit|titik|buah)?";

// One count proposed from the words: "tidak ada <words>", "<words> 5", or "lima rumah <words>".
function proposed(text: string, fieldId: FieldId, words: string) {
  const said = `(?:${words})`;
  const none = new RegExp(`tidak ada (?:yang )?${said}`).exec(text);
  if (none) return [{ field: fieldId, value: "0", quote: none[0] }];
  const match =
    new RegExp(`${said} (?:sebanyak |berjumlah |ada |jadi )?(\\d[\\d.]*)`).exec(text) ??
    new RegExp(`${NUMBER} ${UNIT} ?${said}`).exec(text);
  return match ? [{ field: fieldId, value: String([...findNumbers(match[1] as string)][0]), quote: match[0] }] : [];
}

// Reads counts and hazard types from a message without the model, in the model's answer shape,
// so the same checks keep a value only when its quote holds that number.
export function templateParse(message: MaskedText): unknown {
  const text = folded(message);
  const fields = COUNT_WORDS.flatMap(([fieldId, words]) => proposed(text, fieldId, words));
  const hazardGuesses = HAZARD_WORDS.filter(([, pattern]) => pattern.test(text)).map(([hazardType]) => ({
    hazardType,
    confidence: 1,
  }));
  return { fields, hazardGuesses, lifeAtRisk: false, reply: null, topic: "disaster" };
}
