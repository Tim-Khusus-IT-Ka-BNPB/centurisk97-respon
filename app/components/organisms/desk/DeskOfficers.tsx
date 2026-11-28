import { Form, useNavigation } from "react-router";
import type { DeskReport } from "../../../../src/contract/desk";
import type { OfficerNumber } from "../../../lib/deskTypes";
import { useText } from "../../../lib/text";
import { Button, buttonStyles } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";
import { spacedNumber, when } from "./parts";

type Officers = NonNullable<DeskReport["officers"]>;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

const avatar = "flex size-10 shrink-0 items-center justify-center rounded-full bg-selected font-bold text-primary";
const callButton = buttonStyles({ variant: "secondary", size: "min", className: "no-underline" });

function Row({ officer, opened }: { readonly officer: Officers["items"][number]; readonly opened: string | null }) {
  const t = useText();
  const navigation = useNavigation();
  const busy = navigation.formData?.get("profileId") === officer.profileId;
  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span aria-hidden="true" className={avatar}>
        {initials(officer.name)}
      </span>
      <div className="flex min-w-0 flex-1 basis-40 flex-col">
        <p className="font-semibold break-words">{officer.name}</p>
        <p className="text-meta text-muted break-words">
          {t(officer.level === "regency" ? "desk.officers.role" : "desk.officers.roleProvince", {
            position: officer.position,
            agency: officer.agency,
          })}
        </p>
        <p className="text-meta tabular-nums">{opened === null ? officer.masked : spacedNumber(opened)}</p>
        {officer.signedInAt === null ? null : (
          <p className="text-meta text-muted tabular-nums">
            {t("desk.officers.lastSeen", { at: when(t, "desk.history.at", officer.signedInAt) })}
          </p>
        )}
      </div>
      {opened === null ? (
        <Form method="post" replace preventScrollReset>
          <input type="hidden" name="action" value="officerNumber" />
          <input type="hidden" name="profileId" value={officer.profileId} />
          <Button
            variant="secondary"
            size="min"
            aria-label={t("desk.officers.showFor", { name: officer.name })}
            busyLabel={busy ? t("desk.officers.busy") : null}
          >
            {t("desk.officers.show")}
          </Button>
        </Form>
      ) : (
        <a href={`tel:${opened}`} className={callButton}>
          <Icon name="phone" className="size-4" />
          {t("desk.officers.call")}
        </a>
      )}
    </li>
  );
}

// Who at the BPBD to call about this report (upstream PF-09): BNPB staff only. Each number opens on
// its own and is logged; with no officer of the regency, the BPBD's own number from its contact file.
export function DeskOfficers({
  officers,
  opened,
}: {
  readonly officers: Officers;
  readonly opened: OfficerNumber | null;
}) {
  const t = useText();
  const { official } = officers;
  return (
    <div className="flex flex-col gap-3">
      {officers.items.length > 0 ? (
        <>
          <p className="text-meta text-muted">{t("desk.officers.hint")}</p>
          <ul className="flex flex-col">
            {officers.items.map((officer) => (
              <Row
                key={officer.profileId}
                officer={officer}
                opened={opened?.profileId === officer.profileId ? opened.number : null}
              />
            ))}
          </ul>
        </>
      ) : null}
      {official === null ? null : (
        <>
          <p className="text-meta text-muted">{t("desk.officers.none")}</p>
          <div className="flex flex-wrap items-center gap-3 rounded-control bg-sunken p-3">
            <span aria-hidden="true" className={avatar}>
              <Icon name="phone" className="size-5" />
            </span>
            <div className="flex min-w-0 flex-1 basis-40 flex-col">
              <p className="font-semibold break-words">
                {official.level === "national" ? t("desk.officers.national") : official.name}
              </p>
              <p className="text-meta text-muted">
                {t(official.level === "national" ? "desk.officers.officialNone" : "desk.officers.official")}
              </p>
            </div>
            <a
              href={`tel:${official.level === "national" ? "117" : official.phone.replace(/[^\d+]/g, "")}`}
              className={callButton}
            >
              <Icon name="phone" className="size-4" />
              {official.level === "national" ? "117" : official.phone}
            </a>
          </div>
        </>
      )}
    </div>
  );
}
