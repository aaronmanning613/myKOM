import { buildApp } from './app.js';
import { loadRootEnvFile, readEnv } from './env.js';

loadRootEnvFile();
const env = readEnv();
const app = buildApp({ logger: true });

try {
  await app.listen({ host: env.host, port: env.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
