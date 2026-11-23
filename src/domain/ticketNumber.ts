import { localDate } from "./eventTime";

const TICKET_NUMBER = /^LA-(\d{2})(\d{2})(\d{2})-(\d{2,})$/;

// The WIB calendar date a send counts under: the day counter key.
export function ticketDay(sentAtMs: number): string {
  return localDate(sentAtMs, "WIB");
}

// "LA-DDMMYY-NN": the WIB date of the send and the day's sequence, two digits or more.
export function formatTicketNumber(day: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new RangeError("A ticket sequence starts at 1");
  const [year, month, date] = day.split("-") as [string, string, string];
  return `LA-${date}${month}${year.slice(2)}-${String(sequence).padStart(2, "0")}`;
}

export function isTicketNumber(text: string): boolean {
  const match = TICKET_NUMBER.exec(text);
  return match !== null && Number(match[4]) >= 1;
}
