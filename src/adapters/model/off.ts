import type { ModelPort } from "../../ports/model";

// No model: every turn takes the template path.
export const modelOff: ModelPort = { extract: async () => null };
