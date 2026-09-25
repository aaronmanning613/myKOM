import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRootEnvFile, readEnv } from './env.js';

describe('readEnv', () => {
  it('defaults the host and port', () => {
    expect(readEnv({})).toEqual({ host: '127.0.0.1', port: 3001 });
  });

  it('reads API_HOST and API_PORT', () => {
    expect(readEnv({ API_HOST: '0.0.0.0', API_PORT: '4000' })).toEqual({
      host: '0.0.0.0',
      port: 4000,
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
