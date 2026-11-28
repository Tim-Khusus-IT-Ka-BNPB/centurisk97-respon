import type { Context } from "hono";
import type { Principal } from "../ports/identity";
import type { ServiceBindings } from "../services/bindings";
import type { CaseMember } from "../services/cases";

// What the Worker hands every API request: the services' bindings.
export type ApiBindings = ServiceBindings;

type ApiVariables = {
  // The client address bucket, set for every request that passed the address check.
  address: string;
  // Set by the identity adapter; a route that needs a reporter refuses when it is absent.
  principal: Principal;
  // A member of a BPBD follow-up file, by their own cookie, on the file's routes.
  caseMember: CaseMember;
};

export type ApiEnv = { Bindings: ApiBindings; Variables: ApiVariables };

export type ApiContext = Context<ApiEnv>;
