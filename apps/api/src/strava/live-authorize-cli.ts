// `pnpm strava:authorize`: re-consent for the live Strava tests. Prints the authorize URL, reads
// the redirect URL (or code) the Runner pastes back, exchanges it and writes the live token file.
// Never prints a token.

import { randomBytes } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { loadRootEnvFile, readEnv } from '../env.js';
import { STRAVA_SCOPES, createStravaClient } from './client.js';
import { LIVE_AUTHORIZE_REDIRECT_URI, parseAuthorizationRedirect } from './live-authorize.js';
import { LIVE_TOKEN_PATH, createLiveTokenStore } from './live-token-store.js';

async function main(): Promise<void> {
  loadRootEnvFile();
  const env = readEnv();
  if (!env.stravaClientId || !env.stravaClientSecret) {
    throw new Error('Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env first');
  }
  const store = createLiveTokenStore();
  const client = createStravaClient({
    clientId: env.stravaClientId,
    clientSecret: env.stravaClientSecret,
    tokenStore: store,
  });
  const state = randomBytes(16).toString('hex');

  stdout.write(
    [
      'Open this URL in your browser, sign in to Strava yourself and approve myKOM:',
      '',
      `  ${client.authorizeUrl({ redirectUri: LIVE_AUTHORIZE_REDIRECT_URI, state })}`,
      '',
      'Strava then sends you to a page on http://localhost/exchange_token that fails to load.',
      "That's expected: copy the whole URL from the address bar.",
      '',
    ].join('\n'),
  );
  const readline = createInterface({ input: stdin, output: stdout });
  let pasted: string;
  try {
    pasted = await readline.question('Paste the URL (or just the code) here: ');
  } finally {
    readline.close();
  }

  const { code, scopes } = parseAuthorizationRedirect(pasted, state);
  const { athlete, ...tokens } = await client.exchangeCode(code);
  await store.write({ ...tokens, scopes });

  stdout.write(
    `\nSaved the live token for athlete ${athlete.id} (${athlete.firstName}) to ${LIVE_TOKEN_PATH}.\n`,
  );
  if (!scopes) {
    stdout.write('Granted scopes are unknown (only the code was pasted).\n');
  } else {
    const missing = STRAVA_SCOPES.filter((scope) => !scopes.includes(scope));
    stdout.write(`Granted scopes: ${scopes.join(', ')}\n`);
    if (missing.length > 0) {
      stdout.write(
        `Missing scopes myKOM asks for: ${missing.join(', ')}. Run this again and tick them all.\n`,
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(`strava:authorize failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
