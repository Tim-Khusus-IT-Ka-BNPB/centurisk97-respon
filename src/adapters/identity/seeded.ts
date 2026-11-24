import { parse } from "hono/utils/cookie";
import { DAY_MS } from "../../domain/time";
import { type Database, row, run, sql } from "../../platform/database";
import { sha256Hex } from "../../platform/keys";
import type { Clock } from "../../ports/clock";
import type { IdentityPort, Principal, StaffPrincipal } from "../../ports/identity";

export const DEVICE_COOKIE = "device_key";
export const SESSION_COOKIE = "seeded_session";

type SessionRow = {
  kind: "reporter" | "staff";
  reporter_id: string | null;
  staff_role: "deskOfficer" | "regionalOfficer" | null;
  staff_id: string | null;
  staff_label: string | null;
  scope_level: "national" | "province" | "regency" | null;
  scope_code: string | null;
};

function staffOf(session: SessionRow): StaffPrincipal {
  return {
    kind: "staff",
    staffId: session.staff_id as string,
    role: session.staff_role as StaffPrincipal["role"],
    label: session.staff_label as string,
    scope:
      session.scope_level === "national"
        ? { level: "national" }
        : { level: session.scope_level as "province" | "regency", code: session.scope_code as string },
  };
}

// The staff sign-in of the seeded adapter: a code is a seeded staff session's token.
export async function isSeededStaffCode(db: Database, code: string): Promise<boolean> {
  const found = await row<{ kind: string }>(
    db,
    sql`select kind from seeded_session where token_hash = ${await sha256Hex(code)} and kind = 'staff'`,
  );
  return found !== null;
}

// Local, test and staging: a seeded session stands for a main-site session, and a device key
// for a typed number bound to this browser. Only fingerprints of both are stored.
export function seededIdentity(db: Database, clock: Clock): IdentityPort {
  return {
    async resolve(headers) {
      const cookies = parse(headers.get("cookie") ?? "");
      const token = cookies[SESSION_COOKIE];
      if (token) {
        const session = await row<SessionRow>(
          db,
          sql`select kind, reporter_id, staff_role, staff_id, staff_label, scope_level, scope_code
            from seeded_session where token_hash = ${await sha256Hex(token)}`,
        );
        if (session?.kind === "reporter") return { kind: "session", reporterId: session.reporter_id as string };
        if (session?.kind === "staff") return staffOf(session);
      }
      const key = cookies[DEVICE_COOKIE];
      if (!key) return { kind: "anonymous" };
      const device = await row<{ id: string; last_seen_at: string }>(
        db,
        sql`select id, last_seen_at from device where key_fingerprint = ${await sha256Hex(key)}`,
      );
      if (!device) return { kind: "anonymous" };
      // Seen is kept to the day: it only decides the 365 day removal, so a page load does not write.
      const nowMs = clock.now();
      if (nowMs - Date.parse(device.last_seen_at) >= DAY_MS)
        await run(db, sql`update device set last_seen_at = ${new Date(nowMs)} where id = ${device.id}`);
      return { kind: "device", deviceId: device.id } satisfies Principal;
    },
  };
}

// The main-site adapter is not built in this release, so production cannot start.
export function upstreamIdentity(): IdentityPort {
  throw new Error("The upstream identity adapter is not built");
}
