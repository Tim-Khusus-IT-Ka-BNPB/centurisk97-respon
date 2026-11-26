import { edgeCache } from "../adapters/cache/edgeCache";
import { mainSiteIdentity } from "../adapters/identity/mainSite";
import { seededIdentity } from "../adapters/identity/seeded";
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
  // The main site's own database, where its sign-in lives; bound in production only.
  mainDb?: Database,
): ServiceBindings {
  if (settings.identityAdapter === "upstream" && mainDb === undefined)
    throw new Error("The upstream identity needs the main site's database (MAIN_DB)");
  const identity =
    settings.identityAdapter === "seeded"
      ? seededIdentity(db, clock)
      : mainSiteIdentity(db, mainDb as Database, clock, settings.keyHmacSecret);
  return {
    settings,
    log,
    db,
    clock,
    identity,
    model: modelFor(settings),
    photos: r2PhotoStore(photos),
    edge: edgeCache(settings.appOrigin),
  };
}
