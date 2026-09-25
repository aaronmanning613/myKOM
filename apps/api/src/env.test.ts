import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DATABASE_URL, DEV_SESSION_SECRET, loadRootEnvFile, readEnv } from './env.js';

describe('readEnv', () => {
  it('has development defaults', () => {
    expect(readEnv({})).toEqual({
      host: '127.0.0.1',
      port: 3001,
      databaseUrl: DEFAULT_DATABASE_URL,
      sessionSecret: DEV_SESSION_SECRET,
      stravaClientId: '',
      stravaClientSecret: '',
    });
  });

  it('reads every variable', () => {
    expect(
      readEnv({
        API_HOST: '0.0.0.0',
        API_PORT: '4000',
        DATABASE_URL: 'postgres://x@db/y',
        SESSION_SECRET: 's'.repeat(32),
        STRAVA_CLIENT_ID: '123',
        STRAVA_CLIENT_SECRET: 'shh',
      }),
    ).toEqual({
      host: '0.0.0.0',
      port: 4000,
      databaseUrl: 'postgres://x@db/y',
      sessionSecret: 's'.repeat(32),
      stravaClientId: '123',
      stravaClientSecret: 'shh',
    });
  });

  it('rejects an invalid port', () => {
    expect(() => readEnv({ API_PORT: 'abc' })).toThrow(/API_PORT/);
  });

  it('requires SESSION_SECRET in production', () => {
    expect(() => readEnv({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET/);
  });

  it('rejects a short SESSION_SECRET', () => {
    expect(() => readEnv({ SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });
});

describe('loadRootEnvFile', () => {
  it('ignores a missing file', () => {
    expect(() => loadRootEnvFile(join(tmpdir(), 'mykom-missing.env'))).not.toThrow();
  });

  it('loads variables from the file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mykom-')), '.env');
    writeFileSync(path, 'MYKOM_TEST_VAR=hello\n');
    loadRootEnvFile(path);
    expect(process.env.MYKOM_TEST_VAR).toBe('hello');
    delete process.env.MYKOM_TEST_VAR;
  });
});
