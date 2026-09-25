import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { loadRootEnvFile, readEnv } from './env.js';
import { createStravaClient } from './strava/client.js';
import { createDbTokenStore } from './strava/token-store.js';

loadRootEnvFile();
const env = readEnv();
const database = createDatabase(env.databaseUrl);
const strava = createStravaClient({
  clientId: env.stravaClientId,
  clientSecret: env.stravaClientSecret,
  tokenStore: createDbTokenStore(database.db),
});
const app = buildApp({ logger: true, database, strava, sessionSecret: env.sessionSecret });
app.addHook('onClose', () => database.close());

try {
  await app.listen({ host: env.host, port: env.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
