import { useText } from "../../lib/text";
import { CallRow } from "./CallRow";

// The national numbers, after any report is sent (upstream, 26 Nov): who to call while the desk reads
// it. Shown at once, with no data to load.
export const NUMBERS = ["112", "117", "115", "119", "110", "113"] as const;

export function NationalNumbers() {
  const t = useText();
  return (
    <section aria-labelledby="national-numbers" className="flex flex-col gap-3">
      <h3 id="national-numbers" className="font-bold">
        {t("card.sent.numbers.title")}
      </h3>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 @split:grid-cols-2">
        {NUMBERS.map((number) => (
          <li key={number}>
            <CallRow number={number} label={t(`card.sent.numbers.${number}`)} first={number === "112"} />
          </li>
        ))}
      </ul>
    </section>
  );
}
