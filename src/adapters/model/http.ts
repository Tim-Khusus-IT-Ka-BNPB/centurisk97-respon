import type { ModelPort } from "../../ports/model";

type HttpModelSettings = {
  readonly baseUrl: string;
  readonly name: string;
  // Absent for the recorded model, a local stub of the provider.
  readonly apiKey: string | null;
};

const API_VERSION = "2023-06-01";
const MAX_TOKENS = 1024;

type ProviderAnswer = { readonly content?: readonly { readonly type?: string; readonly text?: string }[] };

// The provider's Messages API with a structured output. Any failure, refusal, abort or answer
// that is not JSON is null, so the turn falls back to the template question.
export function httpModel(settings: HttpModelSettings, fetchFn: typeof fetch = fetch): ModelPort {
  return {
    async extract(request, signal) {
      const headers: Record<string, string> = { "content-type": "application/json", "anthropic-version": API_VERSION };
      if (settings.apiKey !== null) headers["x-api-key"] = settings.apiKey;
      try {
        const response = await fetchFn(`${settings.baseUrl}/v1/messages`, {
          method: "POST",
          headers,
          signal,
          body: JSON.stringify({
            model: settings.name,
            max_tokens: MAX_TOKENS,
            system: request.system,
            messages: [{ role: "user", content: request.user }],
            output_config: { format: { type: "json_schema", schema: request.schema } },
          }),
        });
        if (!response.ok) return null;
        const answer = (await response.json()) as ProviderAnswer;
        const text = answer.content?.find((block) => block.type === "text")?.text;
        return text === undefined ? null : (JSON.parse(text) as unknown);
      } catch {
        return null;
      }
    },
  };
}
