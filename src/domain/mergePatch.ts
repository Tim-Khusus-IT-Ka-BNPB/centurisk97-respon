// A JSON merge patch (RFC 7396): each value given takes its key's place, an object merges into
// the object there, and null clears the key.
export function mergePatch(
  target: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else if (isObject(value)) merged[key] = mergePatch(isObject(merged[key]) ? merged[key] : {}, value);
    else merged[key] = value;
  }
  return merged;
}

// A JSON object: not null, not an array, not a plain value.
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Object.prototype.toString.call(value) === "[object Object]";
