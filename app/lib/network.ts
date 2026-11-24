// A turn waits at most 8 s. After that, or when the connection drops, the page says so and keeps
// what was typed; the reporter sends again by hand with the same turn key, so nothing counts twice.
const TURN_TIMEOUT_MS = 8000;

export type Lost = { readonly networkLost: true };
export const LOST: Lost = { networkLost: true };

export async function withinTimeout<T>(work: Promise<T>, timeoutMs = TURN_TIMEOUT_MS): Promise<T | Lost> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Lost>((resolve) => {
    timer = setTimeout(() => resolve(LOST), timeoutMs);
  });
  try {
    return await Promise.race([work, late]);
  } catch (error) {
    // A redirect travels as a thrown response and must reach the router.
    if (error instanceof Response) throw error;
    return LOST;
  } finally {
    clearTimeout(timer);
  }
}

export const isLost = (value: unknown): value is Lost =>
  typeof value === "object" && value !== null && "networkLost" in value && value.networkLost === true;
