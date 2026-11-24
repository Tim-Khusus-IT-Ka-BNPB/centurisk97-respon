import { seededIdentity, upstreamIdentity } from "../adapters/identity/seeded";
import { httpModel } from "../adapters/model/http";
import { modelOff } from "../adapters/model/off";
import { type Bucket, r2PhotoStore } from "../adapters/r2/photoStore";
import type { Clock } from "../ports/clock";
import type { ModelPort } from "../ports/model";
import type { ServiceBindings } from "../services/bindings";
import type { Database } from "./database";
import type { Logger } from "./log";
import type { Settings } from "./settings";

function modelFor(settings: Settings): ModelPort {
  const model = settings.model;
  if (model.mode === "off") return modelOff;
  return httpModel({ baseUrl: model.baseUrl, name: model.name, apiKey: model.mode === "live" ? model.apiKey : null });
}

// The ports a request uses, chosen by the settings.
export function createServices(
  settings: Settings,
  log: Logger,
  db: Database,
  photos: Bucket,
  clock: Clock,
): ServiceBindings {
  const identity = settings.identityAdapter === "seeded" ? seededIdentity(db, clock) : upstreamIdentity();
  return { settings, log, db, clock, identity, model: modelFor(settings), photos: r2PhotoStore(photos) };
}
