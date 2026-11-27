import { Link } from "react-router";
import { buttonStyles } from "../components/atoms/Button";
import { Icon } from "../components/atoms/Icon";
import { CallRow } from "../components/molecules/CallRow";
import { NUMBERS } from "../components/molecules/NationalNumbers";
import { ContactSection } from "../components/organisms/ContactSection";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { useText } from "../lib/text";
import { languageOf, PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/numbers";

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, {
    title: "page.numbers.title",
    description: "meta.numbers.description",
    path: "/lapor/nomor-penting",
  });

export const loader = ({ request }: Route.LoaderArgs) => ({
  texts: pickTexts(PAGE_TEXTS.numbers, null, languageOf(request)),
});

// Nomor penting (upstream's home door): the national numbers to call now, the local BPBD's through
// Info daerah, and BNPB's own contacts. Read with no data, so it opens with no signal once seen.
function Numbers() {
  const t = useText();
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="numbers-call" className="flex flex-col gap-3">
        <h2 id="numbers-call" className="text-section font-bold">
          {t("numbers.call")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NUMBERS.map((number) => (
            <li key={number}>
              <CallRow number={number} label={t(`card.sent.numbers.${number}`)} first={number === "112"} />
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="numbers-bpbd" className="flex flex-col gap-3 card-surface p-4 md:p-6">
        <h2 id="numbers-bpbd" className="text-card font-bold">
          {t("numbers.bpbd.title")}
        </h2>
        <p className="max-w-[60ch] text-muted">{t("numbers.bpbd.body")}</p>
        <Link to="/lapor/info" className={buttonStyles({ variant: "secondary", className: "self-start" })}>
          <Icon name="map" className="size-5" />
          {t("numbers.bpbd.go")}
        </Link>
      </section>
      <ContactSection />
    </div>
  );
}

export default function NumbersRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Page
      texts={loaderData.texts}
      wide
      banner={{ title: "numbers.title", lead: "numbers.lead", sigap: { scene: "numbers", copy: "sigap.numbers" } }}
    >
      <Numbers />
    </Page>
  );
}
