// Upstream's preparedness topics (public/lapor/edukasi.json, K28): per topic a title, a summary,
// optional lists for warning signs, before, during and after, numbered points, and its sources.
// No imports, so the Node import scripts share this contract.

type Source = { readonly lembaga: string; readonly judul: string; readonly url: string };

type EducationTopic = {
  readonly id: string;
  readonly judul: string;
  readonly ringkas: string;
  readonly tanda?: readonly string[];
  readonly sebelum?: readonly string[];
  readonly saat?: readonly string[];
  readonly sesudah?: readonly string[];
  readonly butir?: readonly string[];
  readonly sumber: readonly Source[];
};

export type EducationFile = {
  readonly dibuat: string;
  readonly catatan: string;
  readonly topik: readonly EducationTopic[];
};

export const TOPIC_LISTS = ["tanda", "sebelum", "saat", "sesudah", "butir"] as const;

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const isList = (value: unknown) => value === undefined || (Array.isArray(value) && value.every(isText));
const isSource = (value: unknown) => {
  const source = value as Partial<Source> | null;
  return isText(source?.lembaga) && isText(source.judul) && isText(source.url) && /^https:\/\//.test(source.url);
};

const isTopic = (value: unknown): value is EducationTopic => {
  const topic = value as Partial<EducationTopic> | null;
  return (
    isText(topic?.id) &&
    isText(topic.judul) &&
    isText(topic.ringkas) &&
    TOPIC_LISTS.every((list) => isList(topic[list])) &&
    Array.isArray(topic.sumber) &&
    topic.sumber.length > 0 &&
    topic.sumber.every(isSource)
  );
};

// The file as its contract says, or null. Every topic must name at least one source over https.
export function checkEducationFile(json: unknown): EducationFile | null {
  const file = json as Partial<EducationFile> | null;
  if (!isText(file?.dibuat) || !/^\d{4}-\d{2}-\d{2}$/.test(file.dibuat) || typeof file.catatan !== "string")
    return null;
  const topics = file.topik;
  if (!Array.isArray(topics) || topics.length === 0 || !topics.every(isTopic)) return null;
  if (new Set(topics.map((topic) => topic.id)).size !== topics.length) return null;
  return file as EducationFile;
}
