import { tidy } from "./text";

declare const masked: unique symbol;
// Text that has been through maskText. The model port and stored free text accept nothing else.
export type MaskedText = string & { readonly [masked]: true };

const MASK_TOKENS = {
  reporterName: "[nama pelapor]",
  phoneNumber: "[nomor HP]",
  nik: "[NIK]",
  email: "[email]",
} as const;

export type Reporter = { readonly name: string | null; readonly number: string | null };

const LETTER_OR_DIGIT = "\\p{L}\\p{N}";
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function ownNamePattern(name: string | null): RegExp | null {
  if (name === null) return null;
  const words = tidy(name).split(" ").filter(Boolean);
  if (words.length === 0) return null;
  return new RegExp(`(?<![${LETTER_OR_DIGIT}])${words.map(literal).join("\\s+")}(?![${LETTER_OR_DIGIT}])`, "giu");
}

// The stored number is +62 followed by the national digits. Any written form of those digits,
// with or without 0, 62 or +62 in front and with single separators, is the reporter's own number.
function ownNumberPattern(number: string | null): RegExp | null {
  const national = /^\+62(\d+)$/.exec(String(number))?.[1];
  if (!national) return null;
  return new RegExp(`(?<![\\d+])(?:(?:\\+62|62|0)[ .-]?)?${[...national].join("[ .-]?")}(?!\\d)`, "g");
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE_IN_BRACKETS = /\((?:\+62|62|0)[ .-]?8\d{1,3}\)[ .-]?\d{3,4}(?:[ .-]?\d{2,5}){1,2}(?!\d)/g;
// At most four digit groups, so a list of counts ("10 20 30 40 50") is never taken for an id.
const DIGIT_GROUPS = /(?<![\d.,])\d+(?:[ .-]\d+){0,3}(?!\d|[.,-]\d)/g;
const NIK_DIGITS = 16;
const PHONE = /(?<![\d+])(?:\+62|62|0)[ .-]?8(?:[ .-]?\d){7,12}(?!\d)/g;

// Removes the reporter's own full name and own number, then any phone number, NIK and email address.
export function maskText(text: string, reporter: Reporter): MaskedText {
  let result = text;
  const name = ownNamePattern(reporter.name);
  if (name) result = result.replace(name, MASK_TOKENS.reporterName);
  const number = ownNumberPattern(reporter.number);
  if (number) result = result.replace(number, MASK_TOKENS.phoneNumber);
  result = result
    .replace(EMAIL, MASK_TOKENS.email)
    .replace(PHONE_IN_BRACKETS, MASK_TOKENS.phoneNumber)
    .replace(DIGIT_GROUPS, (digits) => (digits.replace(/\D/g, "").length === NIK_DIGITS ? MASK_TOKENS.nik : digits))
    .replace(PHONE, MASK_TOKENS.phoneNumber);
  return result as MaskedText;
}
