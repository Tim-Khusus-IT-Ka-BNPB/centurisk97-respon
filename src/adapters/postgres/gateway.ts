import { type Database, run, sql } from "../../platform/database";

// Takes a message id for a gateway; false when it was used before.
export async function claimMessage(db: Database, gatewayId: string, messageId: string, at: Date): Promise<boolean> {
  const claimed = await run(
    db,
    sql`insert into gateway_message (gateway_id, message_id, received_at) values (${gatewayId}, ${messageId}, ${at})
      on conflict (gateway_id, message_id) do nothing`,
  );
  return claimed === 1;
}

export async function releaseMessage(db: Database, gatewayId: string, messageId: string): Promise<void> {
  await run(db, sql`delete from gateway_message where gateway_id = ${gatewayId} and message_id = ${messageId}`);
}
