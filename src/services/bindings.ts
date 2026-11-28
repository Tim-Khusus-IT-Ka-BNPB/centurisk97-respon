import type { Database } from "../platform/database";
import type { Logger } from "../platform/log";
import type { Settings } from "../platform/settings";
import type { Clock } from "../ports/clock";
import type { EdgeCache } from "../ports/edgeCache";
import type { IdentityPort } from "../ports/identity";
import type { ModelPort } from "../ports/model";
import type { PhotoStore } from "../ports/photoStore";
import type { SignInPort } from "../ports/signIn";

// What every service is handed in place of raw platform bindings. The Worker builds it once per
// request; the API passes it on untouched.
export type ServiceBindings = {
  readonly settings: Settings;
  readonly log: Logger;
  readonly db: Database;
  readonly clock: Clock;
  readonly identity: IdentityPort;
  // Staff sign-in through auth; null where staff sign in with seeded codes.
  readonly signIn: SignInPort | null;
  readonly model: ModelPort;
  readonly photos: PhotoStore;
  readonly edge: EdgeCache;
};
