#!/usr/bin/env node
// Downloads MaxMind's free GeoLite2 City database for `GET /api/locate-ip`.
// Needs MAXMIND_LICENSE_KEY (from the repo-root .env or the environment); writes to
// GEOLITE2_CITY_DB (relative paths are from the repo root). Run it with `pnpm geolite2:update`,
// then restart the API. MaxMind updates the database twice a week.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
// Keep in step with DEFAULT_GEOLITE2_CITY_DB in apps/api/src/env.ts.
const DEFAULT_GEOLITE2_CITY_DB = 'data/geolite2/GeoLite2-City.mmdb';
const EDITION = 'GeoLite2-City';

const envPath = join(repoRoot, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const licenseKey = process.env.MAXMIND_LICENSE_KEY?.trim();
if (!licenseKey) {
  console.error(
    'MAXMIND_LICENSE_KEY is not set. Create a free MaxMind account, generate a license key ' +
      '(https://www.maxmind.com/en/geolite2/signup) and add it to .env.',
  );
  process.exit(1);
}
const target = resolve(repoRoot, process.env.GEOLITE2_CITY_DB?.trim() || DEFAULT_GEOLITE2_CITY_DB);

/** Never print this URL: it contains the license key. */
function downloadUrl(suffix) {
  const url = new URL('https://download.maxmind.com/app/geoip_download');
  url.search = new URLSearchParams({
    edition_id: EDITION,
    license_key: licenseKey,
    suffix,
  }).toString();
  return url;
}

async function download(suffix) {
  const res = await fetch(downloadUrl(suffix));
  if (!res.ok) {
    const hint = res.status === 401 ? ' (check MAXMIND_LICENSE_KEY)' : '';
    throw new Error(`MaxMind download failed: HTTP ${res.status}${hint}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const workDir = mkdtempSync(join(tmpdir(), 'mykom-geolite2-'));
try {
  console.log(`Downloading ${EDITION}...`);
  const [archive, checksumFile] = await Promise.all([
    download('tar.gz'),
    download('tar.gz.sha256'),
  ]);
  const expected = checksumFile.toString('utf8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) throw new Error('Checksum mismatch: the download is corrupt');

  const archivePath = join(workDir, `${EDITION}.tar.gz`);
  await writeFile(archivePath, archive);
  execFileSync('tar', ['-xzf', archivePath, '-C', workDir]);
  // The archive holds one dated folder, e.g. GeoLite2-City_20260922/GeoLite2-City.mmdb.
  const folder = readdirSync(workDir).find((name) => name.startsWith(`${EDITION}_`));
  const mmdb = folder && join(workDir, folder, `${EDITION}.mmdb`);
  if (!mmdb || !existsSync(mmdb)) throw new Error(`No ${EDITION}.mmdb in the download`);

  // Copy next to the target, then rename, so a running API never sees a half-written file.
  mkdirSync(dirname(target), { recursive: true });
  await copyFile(mmdb, `${target}.partial`);
  renameSync(`${target}.partial`, target);
  const buildDate = folder.slice(EDITION.length + 1);
  console.log(`Saved ${EDITION} (${buildDate}) to ${target}. Restart the API to use it.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
