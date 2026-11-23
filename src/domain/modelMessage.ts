// The masked message travels to the model inside these tags, and the recorded model finds it there.
export const MESSAGE_OPEN = "<reporter_message>";
export const MESSAGE_CLOSE = "</reporter_message>";

const TAGGED = new RegExp(`${MESSAGE_OPEN}([\\s\\S]*)${MESSAGE_CLOSE}`);

export function messageOf(user: string): string | null {
  return TAGGED.exec(user)?.[1] ?? null;
}
