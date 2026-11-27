import type { Card } from "../../../src/contract/card";
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

type Nearest = Extract<Card, { kind: "sent" }>["nearest"];

// The hospitals, health centres, police and fire stations nearest the report's place, with a number
// to call (upstream row 21, from OpenStreetMap and Overture Maps). None near, none shown.
export function NearestNumbers({ nearest }: { readonly nearest: Nearest }) {
  const t = useText();
  if (nearest.length === 0) return null;
  return (
    <section aria-labelledby="nearest-numbers" className="flex flex-col gap-3">
      <h3 id="nearest-numbers" className="font-bold">
        {t("card.sent.nearest.title")}
      </h3>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 @split:grid-cols-2">
        {nearest.map((one) => (
          <li key={`${one.kind}-${one.name}-${one.phone}`}>
            <CallRow
              number={one.phone.replace(/^\+62/, "0")}
              label={t("card.sent.nearest.item", {
                name: one.name,
                kind: t(`card.sent.nearest.kind.${one.kind}`),
                km: one.km,
              })}
            />
          </li>
        ))}
      </ul>
      <p className="text-meta text-muted">{t("card.sent.nearest.source")}</p>
    </section>
  );
}
