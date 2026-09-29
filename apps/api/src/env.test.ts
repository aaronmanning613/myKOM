import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DATABASE_URL,
  DEFAULT_GEOLITE2_CITY_DB,
  DEV_SESSION_SECRET,
  DEV_TOKEN_ENCRYPTION_KEY,
  loadRootEnvFile,
  readEnv,
  usesDevTokenEncryptionKey,
} from './env.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
/** The secrets production requires. */
const PRODUCTION = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://x@db/y',
  SESSION_SECRET: 's'.repeat(32),
  TOKEN_ENCRYPTION_KEY: KEY_BASE64,
  STRAVA_CLIENT_ID: '123',
  STRAVA_CLIENT_SECRET: 'shh',
};

describe('readEnv', () => {
  it('has development defaults', () => {
    expect(readEnv({})).toEqual({
      host: '127.0.0.1',
      port: 3001,
      databaseUrl: DEFAULT_DATABASE_URL,
      sessionSecret: DEV_SESSION_SECRET,
      tokenEncryptionKey: DEV_TOKEN_ENCRYPTION_KEY,
      stravaClientId: '',
      stravaClientSecret: '',
      nominatimUserAgent: undefined,
      geolite2CityDbPath: join(repoRoot, DEFAULT_GEOLITE2_CITY_DB),
      trustProxy: false,
      testMode: false,
      liveMode: false,
      production: false,
      tickOidc: undefined,
    });
  });

  it('reads every variable', () => {
    expect(
      readEnv({
        API_HOST: '0.0.0.0',
        API_PORT: '4000',
        DATABASE_URL: 'postgres://x@db/y',
        SESSION_SECRET: 's'.repeat(32),
        TOKEN_ENCRYPTION_KEY: KEY_BASE64,
        STRAVA_CLIENT_ID: '123',
        STRAVA_CLIENT_SECRET: 'shh',
        NOMINATIM_USER_AGENT: 'myKOM/0.1 (runner@example.com)',
        GEOLITE2_CITY_DB: '/var/lib/geoip/GeoLite2-City.mmdb',
        TRUST_PROXY: 'true',
        TICK_OIDC_AUDIENCE: 'https://mykom.example.run.app',
        TICK_SERVICE_ACCOUNT: 'scheduler@project.iam.gserviceaccount.com',
      }),
    ).toEqual({
      host: '0.0.0.0',
      port: 4000,
      databaseUrl: 'postgres://x@db/y',
      sessionSecret: 's'.repeat(32),
      tokenEncryptionKey: Buffer.from(KEY_BASE64, 'base64'),
      stravaClientId: '123',
      stravaClientSecret: 'shh',
      nominatimUserAgent: 'myKOM/0.1 (runner@example.com)',
      geolite2CityDbPath: '/var/lib/geoip/GeoLite2-City.mmdb',
      trustProxy: true,
      testMode: false,
      liveMode: false,
      production: false,
      tickOidc: {
        audience: 'https://mykom.example.run.app',
        serviceAccountEmail: 'scheduler@project.iam.gserviceaccount.com',
      },
    });
  });

  it('takes a relative GEOLITE2_CITY_DB from the repo root', () => {
    expect(readEnv({ GEOLITE2_CITY_DB: 'geo/City.mmdb' }).geolite2CityDbPath).toBe(
      join(repoRoot, 'geo/City.mmdb'),
    );
  });

  it.each([
    ['', false],
    ['false', false],
    ['TRUE', true],
    ['10.0.0.1', ['10.0.0.1']],
    [' 10.0.0.0/8 , ::1 ', ['10.0.0.0/8', '::1']],
  ])('reads TRUST_PROXY %j', (value, trustProxy) => {
    expect(readEnv({ TRUST_PROXY: value }).trustProxy).toEqual(trustProxy);
  });

  it.each([
    [{ TICK_OIDC_AUDIENCE: 'https://mykom.example.run.app' }],
    [{ TICK_SERVICE_ACCOUNT: 'scheduler@project.iam.gserviceaccount.com' }],
  ])('needs both tick OIDC variables or neither (%o)', (source) => {
    expect(() => readEnv(source)).toThrow(/must be set together/);
  });

  it('knows when it is production', () => {
    expect(readEnv(PRODUCTION).production).toBe(true);
    expect(readEnv({ NODE_ENV: 'development' }).production).toBe(false);
  });

  it('treats a blank NOMINATIM_USER_AGENT as unset', () => {
    expect(readEnv({ NOMINATIM_USER_AGENT: '  ' }).nominatimUserAgent).toBeUndefined();
  });

  it.each([
    [{ NODE_ENV: 'test' }, true],
    [{ E2E: '1' }, true],
    [{ NODE_ENV: 'development' }, false],
    [{ ...PRODUCTION, E2E: '1' }, false],
  ])('turns test mode on only outside production (%o)', (source, testMode) => {
    expect(readEnv(source).testMode).toBe(testMode);
  });

  it.each([
    [{ E2E_LIVE: '1' }, true],
    [{ E2E_LIVE: '0' }, false],
    [{ ...PRODUCTION, E2E_LIVE: '1' }, false],
  ])('turns live mode on only outside production (%o)', (source, liveMode) => {
    expect(readEnv(source).liveMode).toBe(liveMode);
  });

  it.each([
    { E2E_LIVE: '1', E2E: '1' },
    { E2E_LIVE: '1', NODE_ENV: 'test' },
  ])('refuses live mode together with test mode (%o)', (source) => {
    expect(() => readEnv(source)).toThrow(/E2E_LIVE/);
  });

  it('rejects an invalid port', () => {
    expect(() => readEnv({ API_PORT: 'abc' })).toThrow(/API_PORT/);
  });

  it.each(['DATABASE_URL', 'STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'])(
    'requires %s in production',
    (name) => {
      expect(() => readEnv({ ...PRODUCTION, [name]: ' ' })).toThrow(`${name} must be set`);
      expect(() => readEnv({ ...PRODUCTION, [name]: undefined })).toThrow(`${name} must be set`);
    },
  );

  it('listens on every interface at PORT in production', () => {
    expect(readEnv({ ...PRODUCTION, PORT: '8080', API_PORT: '4000' })).toMatchObject({
      host: '0.0.0.0',
      port: 8080,
    });
    expect(readEnv({ ...PRODUCTION, API_HOST: '127.0.0.1' })).toMatchObject({
      host: '127.0.0.1',
      port: 3001,
    });
    expect(() => readEnv({ ...PRODUCTION, PORT: 'x' })).toThrow(/PORT must be a valid port/);
  });

  it('ignores PORT outside production', () => {
    expect(readEnv({ PORT: '8080' })).toMatchObject({ host: '127.0.0.1', port: 3001 });
  });

  it('requires SESSION_SECRET in production', () => {
    expect(() => readEnv({ ...PRODUCTION, SESSION_SECRET: undefined })).toThrow(/SESSION_SECRET/);
  });

  it('rejects a short SESSION_SECRET', () => {
    expect(() => readEnv({ SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  it('requires TOKEN_ENCRYPTION_KEY in production', () => {
    expect(() => readEnv({ ...PRODUCTION, TOKEN_ENCRYPTION_KEY: '' })).toThrow(
      /TOKEN_ENCRYPTION_KEY must be set/,
    );
    expect(readEnv(PRODUCTION).tokenEncryptionKey).toEqual(Buffer.from(KEY_BASE64, 'base64'));
  });

  it.each([
    ['too short', Buffer.alloc(16, 1).toString('base64')],
    ['too long', Buffer.alloc(33, 1).toString('base64')],
    ['not base64', 'not a base64 key at all, just some text!!'],
  ])('rejects a TOKEN_ENCRYPTION_KEY that is %s', (_, value) => {
    expect(() => readEnv({ TOKEN_ENCRYPTION_KEY: value })).toThrow(/32 bytes, base64/);
  });

  it('falls back to the development key outside production, and says so', () => {
    expect(usesDevTokenEncryptionKey(readEnv({}))).toBe(true);
    expect(usesDevTokenEncryptionKey(readEnv({ TOKEN_ENCRYPTION_KEY: KEY_BASE64 }))).toBe(false);
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
