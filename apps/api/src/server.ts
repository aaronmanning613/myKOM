import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { loadRootEnvFile, readEnv } from './env.js';

loadRootEnvFile();
const env = readEnv();
const database = createDatabase(env.databaseUrl);
const app = buildApp({ logger: true, isDatabaseReachable: database.isReachable });
app.addHook('onClose', () => database.close());

try {
  await app.listen({ host: env.host, port: env.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
