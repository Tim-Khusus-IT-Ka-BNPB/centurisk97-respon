import { createRoute, z } from "@hono/zod-openapi";
import {
  chatMessageSchema,
  chatPhotoSchema,
  chatRefusalSchema,
  chatReplySchema,
  languagesSchema,
  okSchema,
  waitingNewsSchema,
} from "../../contract/gateway";
import { copy } from "../../copy";
import { normaliseNumber } from "../../domain/phoneNumber";
import { type ChatAnswer, chatMessage, chatPhoto } from "../../services/chat";
import { newsDocument, newsSent, waitingNews } from "../../services/chatNews";
import type { ApiContext } from "../context";
import { type Api, addRoute, jsonBody, jsonResponse } from "../route";
import { documentFile, documentSent } from "./shared";

const refusedWith = (description: string) => jsonResponse(description, chatRefusalSchema);

const malformed = (c: ApiContext, why: "number" | "photo"): Response =>
  c.json({ galat: copy.text(`whatsapp.refused.${why}`) }, 400);

function answered(c: ApiContext, answer: ChatAnswer): Response {
  switch (answer.kind) {
    case "reply":
      return c.json({ teksWa: answer.text }, 200);
    case "notNow":
      return c.json({ galat: answer.text, teksWa: answer.text }, 409);
    default: {
      const sisaDetik = Math.ceil((answer.retryAtMs - c.env.clock.now()) / 1000);
      c.header("retry-after", String(sisaDetik));
      return c.json({ galat: answer.text, teksWa: answer.text, sisaDetik }, 429);
    }
  }
}

const unknownNews = (c: ApiContext): Response => c.json({ galat: copy.text("whatsapp.refused.news") }, 404);

const newsId = z.object({ id: z.coerce.number().int().positive() });

const DATA_PREFIX = /^data:image\/jpeg;base64,/;

function photoBytes(data: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(data.replace(DATA_PREFIX, "")), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export function addGatewayRoutes(api: Api): void {
  addRoute(
    api,
    "gateway",
    createRoute({
      method: "post",
      path: "/pesan",
      request: { body: jsonBody(chatMessageSchema) },
      responses: {
        200: jsonResponse("What to send back", chatReplySchema),
        400: refusedWith("No number, or neither words nor a location"),
        429: refusedWith("The number is over its message limit"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const number = normaliseNumber(body.wa);
      if (number === null) return malformed(c, "number");
      const sent = body.lokasi
        ? { point: { lat: body.lokasi.lat, lon: body.lokasi.lon } }
        : { text: (body.teks ?? "").trim() };
      if ("text" in sent && sent.text === "") return malformed(c, "number");
      return answered(c, await chatMessage(c.env, number, sent));
    },
  );

  addRoute(
    api,
    "gateway",
    createRoute({
      method: "post",
      path: "/foto",
      request: { body: jsonBody(chatPhotoSchema) },
      responses: {
        200: jsonResponse("What to send back", chatReplySchema),
        400: refusedWith("No number, or no photo"),
        409: refusedWith("No photo is asked for now, or this one is refused; or the message id was used before"),
        429: refusedWith("The number is over its message limit"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const number = normaliseNumber(body.wa);
      if (number === null) return malformed(c, "number");
      const bytes = photoBytes(body.data);
      if (bytes === null) return malformed(c, "photo");
      return answered(c, await chatPhoto(c.env, number, bytes, body.waktu ?? c.env.clock.now()));
    },
  );

  addRoute(
    api,
    "gateway",
    createRoute({
      method: "get",
      path: "/kabar",
      responses: { 200: jsonResponse("News and documents that wait to be sent", waitingNewsSchema) },
    }),
    async (c) => c.json(await waitingNews(c.env), 200),
  );

  addRoute(
    api,
    "gateway",
    createRoute({
      method: "get",
      path: "/kabar/{id}/berkas",
      request: { params: newsId },
      responses: {
        200: documentFile("The document of news that waits"),
        404: refusedWith("No such news, or none that waits"),
      },
    }),
    async (c) => {
      const file = await newsDocument(c.env, c.req.valid("param").id);
      return file.kind === "file" ? documentSent(c, file) : unknownNews(c);
    },
  );

  addRoute(
    api,
    "gateway",
    createRoute({
      method: "post",
      path: "/kabar/{id}/terkirim",
      request: { params: newsId },
      responses: {
        200: jsonResponse("Marked as sent", okSchema),
        404: refusedWith("No such news, or marked before"),
      },
    }),
    async (c) => {
      const marked = await newsSent(c.env, c.var.gatewayId, c.req.valid("param").id);
      return marked ? c.json({ ok: true as const }, 200) : unknownNews(c);
    },
  );

  addRoute(
    api,
    "gateway",
    createRoute({
      method: "get",
      path: "/bahasa",
      responses: { 200: jsonResponse("The languages a chat may be held in", languagesSchema) },
    }),
    (c) => c.json({ bahasa: [{ kode: "id", nama: copy.text("whatsapp.language") }] }, 200),
  );
}
