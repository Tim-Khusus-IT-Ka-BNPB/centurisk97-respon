import type { Context } from "hono";
import type { Principal } from "../ports/identity";
import type { ServiceBindings } from "../services/bindings";

// What the Worker hands every API request: the services' bindings.
export type ApiBindings = ServiceBindings;

type ApiVariables = {
  // The client address bucket, set for every request that passed the address check.
  address: string;
  // Set by the identity adapter; a route that needs a reporter refuses when it is absent.
  principal: Principal;
  // The gateway whose signature a call carries, on the gateway's own routes.
  gatewayId: string;
};

export type ApiEnv = { Bindings: ApiBindings; Variables: ApiVariables };

export type ApiContext = Context<ApiEnv>;
