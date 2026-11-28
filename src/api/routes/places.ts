import { createRoute, z } from "@hono/zod-openapi";
import { placeResultsSchema } from "../../contract/card";
import { type AreaLevel, checkPlaceQuery } from "../../domain/placeSearch";
import { checkLimits } from "../../services/limits";
import { type Admit, areaVillages, locatePlace, type PlaceAnswer, searchPlaces } from "../../services/places";
import type { ApiContext } from "../context";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { fieldErrors, limitRefused } from "./shared";

// Longer than a query may be, so the refusal can name the field instead of a malformed request.
const queryText = z.string().max(400);

const areaSchema = z.object({
  level: z.enum(["regency", "district"]),
  code: z.string(),
  name: z.string(),
  regencyName: z.string(),
  provinceName: z.string(),
});

const failures = {
  404: refusal("No such regency or district in the active place data"),
  422: refusal("The query is too short or too long"),
  429: refusal("Search limit for this address"),
  503: refusal("Place data cannot be read now: place.unavailable"),
};

// Checks the query and the address's search limit, then answers with the search or its refusal.
async function answerSearch<T>(
  c: ApiContext,
  query: string,
  insideArea: boolean,
  search: (admit: Admit) => Promise<PlaceAnswer<T>>,
): Promise<Response> {
  const invalid = checkPlaceQuery(query, insideArea);
  if (invalid) return refuse(c, 422, "request.invalidFields", { fields: fieldErrors([invalid]) });
  const answer = await search(() =>
    checkLimits(c.env, [["address.searches", { kind: "address", bucket: c.var.address }]]),
  );
  if (answer.kind === "unavailable") return refuse(c, 503, "place.unavailable");
  if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
  if (answer.kind === "noArea") return refuse(c, 404, "request.refused");
  return c.json(answer.value as object, 200);
}

function addAreaRoute(api: Api, level: AreaLevel, segment: string, code: RegExp): void {
  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: `/places/${segment}/{code}/villages`,
      request: {
        params: z.object({ code: z.string().regex(code) }),
        query: z.object({ q: queryText.default("") }),
      },
      responses: {
        200: jsonResponse(
          `Up to 40 villages of the ${level}, every typed word matching`,
          placeResultsSchema.extend({ area: areaSchema }),
        ),
        ...failures,
      },
    }),
    (c) => {
      const { q } = c.req.valid("query");
      return answerSearch(c, q, true, (admit) => areaVillages(c.env, level, c.req.valid("param").code, q, admit));
    },
  );
}

export function addPlaceRoutes(api: Api): void {
  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/places/search",
      request: { query: z.object({ q: queryText }) },
      responses: {
        200: jsonResponse(
          "Up to 10 places, regencies and districts first, every typed word matching",
          placeResultsSchema,
        ),
        ...failures,
      },
    }),
    (c) => {
      const { q } = c.req.valid("query");
      return answerSearch(c, q, false, (admit) => searchPlaces(c.env, q, admit));
    },
  );
  // The phone's reading as a place, for pages that need its regency: never kept, and never in an address.
  addRoute(
    api,
    "public",
    createRoute({
      method: "post",
      path: "/places/at",
      request: {
        body: jsonBody(
          z.object({
            lat: z.number().min(-90).max(90),
            lon: z.number().min(-180).max(180),
            accuracyM: z.number().min(0).max(1e7),
          }),
        ),
      },
      responses: {
        200: jsonResponse(
          "The village at the reading, with its regency",
          z.object({
            regency: z.object({ code: z.string(), name: z.string(), provinceName: z.string() }),
            village: z.object({ name: z.string(), districtName: z.string() }),
          }),
        ),
        404: refusal("The reading is outside Indonesia or near no village"),
        429: failures[429],
        503: failures[503],
      },
    }),
    async (c) => {
      const limited = await checkLimits(c.env, [["address.searches", { kind: "address", bucket: c.var.address }]]);
      if (limited) return limitRefused(c, limited, null);
      const located = await locatePlace(c.env, c.req.valid("json"));
      if (located.kind === "unavailable") return refuse(c, 503, "place.unavailable");
      if (located.kind !== "found") return refuse(c, 404, "request.refused");
      const { village } = located.reading;
      return c.json(
        {
          regency: {
            code: village.villageCode.slice(0, 5),
            name: village.regencyName,
            provinceName: village.provinceName,
          },
          village: { name: village.villageName, districtName: village.districtName },
        },
        200,
      );
    },
  );
  addAreaRoute(api, "regency", "regencies", /^\d{2}\.\d{2}$/);
  addAreaRoute(api, "district", "districts", /^\d{2}\.\d{2}\.\d{2}$/);
}
