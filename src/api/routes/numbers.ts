import { createRoute, z } from "@hono/zod-openapi";
import {
  bpbdEditSchema,
  deskBpbdNumbersSchema,
  deskFacilityNumbersSchema,
  facilityEditSchema,
  numbersSavedSchema,
} from "../../contract/numbers";
import { FACILITY_KINDS } from "../../domain/facilities";
import {
  deskBpbdNumbers,
  deskFacilityNumbers,
  editBpbdNumbers,
  editFacilityNumbers,
  type NumbersEdited,
} from "../../services/numbers";
import type { ApiContext } from "../context";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { answered, staffOf } from "./desk";

const page = z.coerce.number().int().min(1).max(10_000).default(1);
const search = z.string().max(60).default("");

// A field refused is named with the desk's own line for it.
function edited(c: ApiContext, answer: NumbersEdited): Response {
  if (answer.kind === "invalid")
    return refuse(c, 422, "request.invalidFields", {
      fields: answer.errors.map((error) => ({
        fieldId: error.fieldId,
        copyKey: `desk.numbers.error.${error.rule}`,
        params: {},
      })),
    });
  if (answer.kind === "changed") return refuse(c, 409, "numbers.changed");
  if (answer.kind === "emptied") return refuse(c, 409, "numbers.emptied");
  if (answer.kind === "notFound") return refuse(c, 404, "numbers.notFound");
  return answered(c, answer);
}

const editResponses = {
  200: jsonResponse("Kept; the file's new checksum", numbersSavedSchema),
  404: refusal("No such area or entry"),
  422: refusal("A value refused, named on its field"),
  409: refusal("Another edit or an import came first, or the file would be left empty"),
};

// BNPB keeps the BPBD numbers and the facility numbers a reporter is shown.
export function addNumbersRoutes(api: Api): void {
  addRoute(
    api,
    "staff",
    createRoute({
      method: "get",
      path: "/desk/numbers/bpbd",
      request: { query: z.object({ q: search, page, empty: z.enum(["1"]).optional() }) },
      responses: {
        200: jsonResponse("A page of the provinces and regencies with their BPBD numbers", deskBpbdNumbersSchema),
      },
    }),
    async (c) => {
      const { q, page, empty } = c.req.valid("query");
      return answered(c, await deskBpbdNumbers(c.env, staffOf(c), { q, page, empty: empty === "1" }));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "get",
      path: "/desk/numbers/facilities",
      request: { query: z.object({ q: search, page, kind: z.enum(FACILITY_KINDS).optional() }) },
      responses: { 200: jsonResponse("A page of the facilities with their numbers", deskFacilityNumbersSchema) },
    }),
    async (c) => {
      const { q, page, kind } = c.req.valid("query");
      return answered(c, await deskFacilityNumbers(c.env, staffOf(c), { q, page, kind: kind ?? null }));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/numbers/bpbd",
      request: { body: jsonBody(bpbdEditSchema) },
      responses: editResponses,
    }),
    async (c) => {
      const { checksum, edit } = c.req.valid("json");
      return edited(c, await editBpbdNumbers(c.env, staffOf(c), checksum, edit));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/numbers/facilities",
      request: { body: jsonBody(facilityEditSchema) },
      responses: editResponses,
    }),
    async (c) => {
      const { checksum, edit } = c.req.valid("json");
      return edited(c, await editFacilityNumbers(c.env, staffOf(c), checksum, edit));
    },
  );
}
