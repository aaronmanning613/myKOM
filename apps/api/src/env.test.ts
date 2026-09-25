import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DATABASE_URL,
  DEFAULT_GEOLITE2_CITY_DB,
  DEV_SESSION_SECRET,
  loadRootEnvFile,
  readEnv,
} from './env.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('readEnv', () => {
  it('has development defaults', () => {
    expect(readEnv({})).toEqual({
      host: '127.0.0.1',
      port: 3001,
      databaseUrl: DEFAULT_DATABASE_URL,
      sessionSecret: DEV_SESSION_SECRET,
      stravaClientId: '',
      stravaClientSecret: '',
      nominatimUserAgent: undefined,
      geolite2CityDbPath: join(repoRoot, DEFAULT_GEOLITE2_CITY_DB),
      trustProxy: false,
      testMode: false,
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
        NOMINATIM_USER_AGENT: 'myKOM/0.1 (runner@example.com)',
        GEOLITE2_CITY_DB: '/var/lib/geoip/GeoLite2-City.mmdb',
        TRUST_PROXY: 'true',
      }),
    ).toEqual({
      host: '0.0.0.0',
      port: 4000,
      databaseUrl: 'postgres://x@db/y',
      sessionSecret: 's'.repeat(32),
      stravaClientId: '123',
      stravaClientSecret: 'shh',
      nominatimUserAgent: 'myKOM/0.1 (runner@example.com)',
      geolite2CityDbPath: '/var/lib/geoip/GeoLite2-City.mmdb',
      trustProxy: true,
      testMode: false,
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

  it('treats a blank NOMINATIM_USER_AGENT as unset', () => {
    expect(readEnv({ NOMINATIM_USER_AGENT: '  ' }).nominatimUserAgent).toBeUndefined();
  });

  it.each([
    [{ NODE_ENV: 'test' }, true],
    [{ E2E: '1' }, true],
    [{ NODE_ENV: 'development' }, false],
    [{ NODE_ENV: 'production', E2E: '1', SESSION_SECRET: 's'.repeat(32) }, false],
  ])('turns test mode on only outside production (%o)', (source, testMode) => {
    expect(readEnv(source).testMode).toBe(testMode);
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
