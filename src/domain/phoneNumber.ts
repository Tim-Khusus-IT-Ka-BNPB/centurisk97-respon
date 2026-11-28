// A WhatsApp number is typed starting with 08, 62 or +62, or with its 8 alone after a +62 the form
// shows, and stored as +62 followed by 8 and 8 to 12 more digits (9 to 13 digits after +62).
// Spaces, dots, hyphens and brackets are ignored.
const ALLOWED = /^\+?[\d\s().-]+$/;
const NATIONAL = /^8\d{8,12}$/;

function nationalPart(text: string, digits: string): string | null {
  if (text.startsWith("+")) return digits.startsWith("62") ? digits.slice(2) : null;
  if (digits.startsWith("0")) return digits.slice(1);
  if (digits.startsWith("8")) return digits;
  return digits.startsWith("62") ? digits.slice(2) : null;
}

export function normaliseNumber(typed: string): string | null {
  const text = typed.trim();
  if (!ALLOWED.test(text)) return null;
  const national = nationalPart(text, text.replace(/\D/g, ""));
  return NATIONAL.test(String(national)) ? `+62${national}` : null;
}

// "0800****0001": shown in the list of numbers known on a device.
export function maskNumber(stored: string): string {
  return `0${stored.slice(3, 6)}****${stored.slice(-4)}`;
}

// "+62 800 0000 0001": the number read back before it is stored.
export function readBackNumber(stored: string): string {
  const national = stored.slice(3);
  return `+62 ${national.slice(0, 3)} ${national.slice(3, 7)} ${national.slice(7)}`;
}
