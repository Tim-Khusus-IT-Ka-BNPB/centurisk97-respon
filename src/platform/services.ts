import { edgeCache } from "../adapters/cache/edgeCache";
import { authIdentity } from "../adapters/identity/auth";
import { seededIdentity } from "../adapters/identity/seeded";
import { httpModel } from "../adapters/model/http";
import { modelOff } from "../adapters/model/off";
import { oidcSignIn } from "../adapters/oidc/client";
import { MEMORY_S3, memoryBucket } from "../adapters/s3/memoryBucket";
import { s3PhotoStore } from "../adapters/s3/store";
import type { Clock } from "../ports/clock";
import type { ModelPort } from "../ports/model";
import type { PhotoStore } from "../ports/photoStore";
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
// The file store the settings name: S3, or, on one's own machine and in tests, a bucket in memory.
export const photoStoreOf = (settings: Settings): PhotoStore =>
  settings.s3 === null ? s3PhotoStore(MEMORY_S3, memoryBucket().fetcher) : s3PhotoStore(settings.s3);

export function createServices(
  settings: Settings,
  log: Logger,
  db: Database,
  photos: PhotoStore,
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
    photos,
    edge: edgeCache(settings.appOrigin),
  };
}
