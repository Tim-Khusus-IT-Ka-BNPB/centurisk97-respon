import type { Database } from "../platform/database";
import type { Logger } from "../platform/log";
import type { Settings } from "../platform/settings";
import type { Clock } from "../ports/clock";
import type { IdentityPort } from "../ports/identity";
import type { ModelPort } from "../ports/model";

// What every service is handed in place of raw platform bindings. The Worker builds it once per
// request; the API passes it on untouched.
export type ServiceBindings = {
  readonly settings: Settings;
  readonly log: Logger;
  readonly db: Database;
  readonly clock: Clock;
  readonly identity: IdentityPort;
  readonly model: ModelPort;
};
