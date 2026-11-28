import { parse } from "hono/utils/cookie";
import type { StaffAccount } from "../../domain/staffClaims";
import { type Database, row, rows, run, sql } from "../../platform/database";
import { sha256Hex } from "../../platform/keys";
import type { Clock } from "../../ports/clock";
import type { IdentityPort, Officer, StaffPrincipal } from "../../ports/identity";
import { DEVICE_COOKIE, deviceOf } from "./seeded";

// A desk sign-in through auth lasts as long as auth's own session.
export const STAFF_SESSION_MS = 8 * 60 * 60 * 1000;

// An officer who has not signed in for this long is no longer listed to call: auth does not tell
// respon when someone leaves, so a sign-in is the only sign they still work there.
export const OFFICER_LISTED_MS = 30 * 24 * 60 * 60 * 1000;

// Over HTTPS the cookie carries the __Host- prefix, so no other subdomain can set or read it.
export const staffCookieName = (secure: boolean) => (secure ? "__Host-respon_staff" : "respon_staff");

const randomToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

// Keeps who signed in, as their claims describe them now, and opens a session for them with the ID
// token auth gave, to sign out of auth with.
export async function signInStaff(db: Database, clock: Clock, account: StaffAccount, idToken: string): Promise<string> {
  const token = randomToken();
  const now = clock.now();
  const code = account.scope.level === "national" ? null : account.scope.code;
  await run(
    db,
    sql`insert into staff_member (id, name, position, agency, phone, role, scope_level, scope_code, signed_in_at)
      values (${account.id}, ${account.name}, ${account.position}, ${account.agency}, ${account.phone}, ${account.role},
        ${account.scope.level}, ${code}, ${new Date(now)})
      on conflict (id) do update set name = excluded.name, position = excluded.position, agency = excluded.agency,
        phone = excluded.phone, role = excluded.role, scope_level = excluded.scope_level, scope_code = excluded.scope_code,
        signed_in_at = excluded.signed_in_at`,
  );
  await run(db, sql`delete from staff_session where expires_at <= ${new Date(now)}`);
  await run(
    db,
    sql`insert into staff_session (token_hash, staff_id, expires_at, id_token)
      values (${await sha256Hex(token)}, ${account.id}, ${new Date(now + STAFF_SESSION_MS)}, ${idToken})`,
  );
  return token;
}

// Ends the session, and gives back the ID token it kept; null when there was no such session.
export async function signOutStaff(db: Database, token: string): Promise<string | null> {
  const ended = await row<{ id_token: string | null }>(
    db,
    sql`delete from staff_session where token_hash = ${await sha256Hex(token)} returning id_token`,
  );
  return ended?.id_token ?? null;
}

// A person whose claims no longer open the desk is forgotten, with their sessions, so they leave
// the officers BNPB may call.
export async function forgetStaff(db: Database, id: string): Promise<void> {
  await run(db, sql`delete from staff_member where id = ${id}`);
}

type MemberRow = {
  id: string;
  name: string;
  position: string;
  agency: string;
  role: StaffPrincipal["role"];
  scope_level: "national" | "province" | "regency";
  scope_code: string | null;
};

const principalOf = (member: MemberRow): StaffPrincipal => ({
  kind: "staff",
  staffId: member.id,
  role: member.role,
  label: member.name,
  scope:
    member.scope_level === "national"
      ? { level: "national" }
      : { level: member.scope_level, code: member.scope_code as string },
  profile: { id: member.id, name: member.name, position: member.position, agency: member.agency },
});

// Production: staff sign in through auth; reporters are known by a typed number bound to the browser.
export function authIdentity(db: Database, clock: Clock, secure: boolean): IdentityPort {
  return {
    async officers(villageCode) {
      const found = await rows<Omit<Officer, "signedInAtMs"> & { signed_in_at: string }>(
        db,
        sql`select id, name, position, agency, phone as number, scope_level as level, signed_in_at from staff_member
          where role = 'regionalOfficer' and phone is not null
            and signed_in_at > ${new Date(clock.now() - OFFICER_LISTED_MS)}
            and ((scope_level = 'regency' and scope_code = ${villageCode.slice(0, 5)})
              or (scope_level = 'province' and scope_code = ${villageCode.slice(0, 2)}))
          order by scope_level = 'province', name`,
      );
      return found.map(({ signed_in_at, ...officer }) => ({ ...officer, signedInAtMs: Date.parse(signed_in_at) }));
    },
    async resolve(headers) {
      const cookies = parse(headers.get("cookie") ?? "");
      const token = cookies[staffCookieName(secure)];
      if (token) {
        const member = await row<MemberRow>(
          db,
          sql`select m.id, m.name, m.position, m.agency, m.role, m.scope_level, m.scope_code
            from staff_session s join staff_member m on m.id = s.staff_id
            where s.token_hash = ${await sha256Hex(token)} and s.expires_at > ${new Date(clock.now())}`,
        );
        if (member) return principalOf(member);
      }
      return deviceOf(db, clock, cookies[DEVICE_COOKIE]);
    },
  };
}
