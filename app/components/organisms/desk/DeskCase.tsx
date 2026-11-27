import { Form, Link, useNavigation } from "react-router";
import type { DeskReport } from "../../../../src/contract/desk";
import { useText } from "../../../lib/text";
import { Button, buttonStyles } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";

// The BPBD's follow-up file of this report (M09): opened here by the BPBD of its regency, reached
// here by anyone who may read it.
export function DeskCase({ caseFile }: { readonly caseFile: NonNullable<DeskReport["caseFile"]> }) {
  const t = useText();
  const navigation = useNavigation();
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-meta text-muted">{t("desk.case.section.hint")}</p>
      {caseFile.file === null ? (
        <Form method="post" replace>
          <input type="hidden" name="action" value="openCase" />
          <Button
            variant="primary"
            busyLabel={navigation.formData?.get("action") === "openCase" ? t("desk.case.saving") : null}
          >
            {t("desk.case.open")}
          </Button>
        </Form>
      ) : (
        <Link to={`/lapor/data/${caseFile.file.id}`} className={buttonStyles({ variant: "secondary" })}>
          <Icon name="fileText" className="size-5" />
          {t("desk.case.openFile")}
          <span className="font-normal text-muted">({t(`desk.case.status.${caseFile.file.status}`)})</span>
        </Link>
      )}
    </div>
  );
}
