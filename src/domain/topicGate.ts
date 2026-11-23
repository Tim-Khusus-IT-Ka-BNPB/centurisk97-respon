import { tidy } from "./text";

// Messages code keeps away from the model and the report. Deliberately narrow (a request verb
// with a data object, a steering phrase, a general writing task), so a story that mentions
// "data" or a list is not refused.
export type TopicVerdict = "dataRequest" | "offTopic";

const alternatives = (words: readonly string[]) => words.join("|");

const REQUEST_VERB = new RegExp(
  `^(?:${alternatives([
    "minta",
    "mintak",
    "kirim(?:kan|in)?",
    "kasih",
    "berikan",
    "beri",
    "bagi(?:kan)?",
    "share",
    "unduh",
    "download",
    "lihat(?:kan)?",
    "tampilkan",
    "sebutkan",
    "tunjukkan",
    "buka(?:kan)?",
    "akses",
    "ekspor",
    "export",
    "bocorkan",
    "cari(?:kan)?",
  ])})$`,
  "i",
);
const REQUEST_FILLERS = new Set(["saya", "aku", "gw", "gue", "dong", "semua", "seluruh"]);
const DATA_OBJECT = new RegExp(
  `^(?:${alternatives([
    "data",
    "rekap",
    "rekapan",
    "daftar laporan",
    "database",
    "basis data",
    "statistik",
    "dokumen",
    "nomor (?:hp|wa|telepon|pelapor)",
    "kontak pelapor",
    "nik",
    "identitas",
    "laporan (?:orang|warga lain|lain)",
    "isi laporan",
  ])})\\b`,
  "i",
);

// The words after position "from", once the given filler words are skipped.
function restAfter(words: readonly string[], from: number, fillers: ReadonlySet<string>): string {
  let next = from;
  while (next < words.length && fillers.has((words[next] as string).toLowerCase())) next += 1;
  return words.slice(next).join(" ");
}

// A request verb, optional fillers, then a data object: "kirimkan saya rekap".
function isDirectRequest(words: readonly string[]): boolean {
  return words.some(
    (word, index) => REQUEST_VERB.test(word) && DATA_OBJECT.test(restAfter(words, index + 1, REQUEST_FILLERS)),
  );
}

const SCOPE_REQUEST = new RegExp(
  `\\b(?:${alternatives(["minta", "kirim(?:kan|in)?", "kasih", "berikan", "tampilkan", "sebutkan", "tunjukkan", "bocorkan", "berapa"])})\\b` +
    `.{0,30}\\b(?:${alternatives(["data", "rekap", "statistik", "jumlah laporan", "daftar laporan"])})\\b` +
    `.{0,40}\\b(?:${alternatives(["bnpb", "internal", "rahasia", "seluruh indonesia", "se-?indonesia", "semua provinsi", "semua kabupaten", "nasional"])})\\b`,
  "i",
);

const STEERING = new RegExp(
  `\\b(?:${alternatives(["abaikan", "lupakan", "ignore", "disregard", "override"])})\\b.{0,40}` +
    `\\b(?:${alternatives(["instruksi", "perintah", "aturan", "instructions?", "prompts?", "rules?"])})\\b` +
    `|\\b(?:${alternatives(["system prompt", "prompt sistem", "jailbreak", "mode developer", "developer mode", "dan mode", "kamu sekarang adalah", "you are now", "act as", "berperan sebagai", "pura-pura jadi"])})\\b`,
  "i",
);

const POLITE_OPENERS = new Set(["tolong", "coba", "bisa", "bisakah", "kamu"]);
const TASK_VERB = new RegExp(
  `^(?:${alternatives([
    "buat(?:kan|in)?",
    "tulis(?:kan|in)?",
    "kerjakan",
    "terjemahkan",
    "translate",
    "ringkas(?:kan)?",
    "jelaskan",
    "hitung(?:kan)?",
    "carikan",
    "rekomendasikan",
    "write",
    "explain",
    "summarize",
  ])})$`,
  "i",
);
const TASK_FILLERS = new Set(["aku", "saya"]);
const TASK_OBJECT = new RegExp(
  `^(?:${alternatives([
    "puisi",
    "pantun",
    "lagu",
    "cerpen",
    "cerita fiksi",
    "esai",
    "essay",
    "makalah",
    "skripsi",
    "tugas",
    "pr\\b",
    "kode",
    "code",
    "program",
    "script",
    "resep",
    "surat lamaran",
    "cv",
    "caption",
    "artikel",
    "soal",
    "jawaban soal",
    "rumus",
    "kalimat",
    "teks",
    "terjemahan",
    "apa itu",
    "siapa",
    "bagaimana cara",
  ])})`,
  "i",
);

// A general writing or homework task at the start of the message: "tolong buatkan puisi".
function isGeneralTask(words: readonly string[]): boolean {
  let verb = 0;
  while (verb < words.length && POLITE_OPENERS.has((words[verb] as string).toLowerCase())) verb += 1;
  return TASK_VERB.test(String(words[verb])) && TASK_OBJECT.test(restAfter(words, verb + 1, TASK_FILLERS));
}

// A story that names an event or holds a digit goes to the model, never refused by code.
const EVENT_WORDS = new RegExp(
  `\\d|\\b(?:${alternatives([
    "banjir",
    "longsor",
    "gempa",
    "tsunami",
    "erupsi",
    "abu",
    "kebakaran",
    "terbakar",
    "api",
    "asap",
    "angin",
    "puting",
    "hujan",
    "kering",
    "kekeringan",
    "abrasi",
    "gelombang",
    "rob",
    "air",
    "rumah",
    "rusak",
    "korban",
    "meninggal",
    "hilang",
    "luka",
    "ungsi",
    "mengungsi",
    "pengungsi",
    "posko",
    "terdampak",
    "retak",
    "roboh",
    "jalan",
    "jembatan",
    "sungai",
    "tanggul",
    "desa",
    "kampung",
  ])})\\b`,
  "i",
);

// Asking for other reporters' details is refused even when the message names a place or an event.
const REPORTER_DATA = new RegExp(
  `\\b(?:${alternatives(["minta", "mintak", "kirim(?:kan|in)?", "kasih", "berikan", "tampilkan", "sebutkan", "tunjukkan", "bocorkan", "bagi(?:kan)?"])})\\b` +
    `.{0,30}\\b(?:${alternatives(["data", "nomor", "kontak", "identitas", "nama", "daftar", "alamat"])})\\b.{0,20}\\bpelapor\\b`,
  "i",
);

export function topicGate(message: string): TopicVerdict | null {
  const text = tidy(message);
  const words = text.split(" ");
  if (SCOPE_REQUEST.test(text) || REPORTER_DATA.test(text)) return "dataRequest";
  if (isDirectRequest(words) && !EVENT_WORDS.test(text)) return "dataRequest";
  if (STEERING.test(text) || isGeneralTask(words)) return "offTopic";
  return null;
}

// After this many off-topic messages a draft runs on templates only.
export const OFF_TOPIC_LIMIT = 3;
