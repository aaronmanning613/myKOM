import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DATABASE_URL, loadRootEnvFile, readEnv } from './env.js';

describe('readEnv', () => {
  it('defaults the host, port and database URL', () => {
    expect(readEnv({})).toEqual({
      host: '127.0.0.1',
      port: 3001,
      databaseUrl: DEFAULT_DATABASE_URL,
    });
  });

  it('reads API_HOST, API_PORT and DATABASE_URL', () => {
    expect(
      readEnv({ API_HOST: '0.0.0.0', API_PORT: '4000', DATABASE_URL: 'postgres://x@db/y' }),
    ).toEqual({
      host: '0.0.0.0',
      port: 4000,
      databaseUrl: 'postgres://x@db/y',
    });
  });

  it('rejects an invalid port', () => {
    expect(() => readEnv({ API_PORT: 'abc' })).toThrow(/API_PORT/);
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
