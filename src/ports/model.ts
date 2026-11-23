import type { ModelRequest } from "../domain/modelRequest";

// The model only extracts values. It answers the structured schema, or null when it has nothing
// usable; the caller checks every value against the reporter's own words.
export type ModelPort = {
  extract(request: ModelRequest, signal: AbortSignal): Promise<unknown>;
};
