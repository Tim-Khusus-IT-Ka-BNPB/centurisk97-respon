import { edgeCache } from "../adapters/cache/edgeCache";
import { authIdentity } from "../adapters/identity/auth";
import { seededIdentity } from "../adapters/identity/seeded";
import { httpModel } from "../adapters/model/http";
import { modelOff } from "../adapters/model/off";
import { oidcSignIn } from "../adapters/oidc/client";
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
  // How auth is reached; tests hand in their own.
  fetcher: typeof fetch = fetch,
): ServiceBindings {
  const secure = settings.appOrigin.startsWith("https://");
  const identity = settings.auth === null ? seededIdentity(db, clock) : authIdentity(db, clock, secure);
  return {
    settings,
    log,
    db,
    clock,
    identity,
    signIn: settings.auth === null ? null : oidcSignIn(settings.auth, fetcher),
    model: modelFor(settings),
    photos: r2PhotoStore(photos),
    edge: edgeCache(settings.appOrigin),
  };
}
