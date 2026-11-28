import { connect } from "../src/platform/postgres.ts";
import seedPlaces from "./seed/0001_places.ts";
import seedIdentities from "./seed/0002_identities.ts";
import seedReference from "./seed/0003_reference.ts";
import { onServer, TEMPLATE, urlOf } from "./testServer.ts";

// Once per run: the template every test file copies, with every migration and the seed.
export async function setup() {
  await onServer(async (client) => {
    await client.query(`drop database if exists ${TEMPLATE} with (force)`);
    await client.query(`create database ${TEMPLATE}`);
  });
  const { db, close } = await connect(urlOf(TEMPLATE));
  try {
    await seedPlaces(db);
    await seedIdentities(db);
    await seedReference(db);
  } finally {
    await close();
  }
}

export async function teardown() {
  await onServer((client) => client.query(`drop database if exists ${TEMPLATE} with (force)`));
}
