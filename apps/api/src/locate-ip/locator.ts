import { existsSync } from 'node:fs';
import { AddressNotFoundError, Reader, ValueError, type ReaderModel } from '@maxmind/geoip2-node';
import type { IpLocation } from '@mykom/shared';

/** The part of a GeoLite2 City reader the locator uses, so tests can stand one in. */
export type CityReader = Pick<ReaderModel, 'city'>;

export type IpLocator = {
  /** Where the address is, or null when the database doesn't place it (private, unknown). */
  locate(ip: string): IpLocation | null;
};

export function createIpLocator(reader: CityReader): IpLocator {
  return {
    locate(ip) {
      let city: ReturnType<CityReader['city']>;
      try {
        city = reader.city(normaliseIp(ip));
      } catch (error) {
        if (error instanceof AddressNotFoundError || error instanceof ValueError) return null;
        throw error;
      }
      const { location } = city;
      if (!location) return null;
      // Most specific first, e.g. "Leeds, England, United Kingdom".
      const names = [city.city, city.subdivisions?.[0], city.country].map((r) => r?.names.en);
      const label = [...new Set(names.filter((name) => !!name))].join(', ');
      if (!label) return null;
      return {
        label,
        lat: location.latitude,
        lng: location.longitude,
        accuracyRadiusKm: location.accuracyRadius ?? null,
      };
    },
  };
}

/**
 * Opens the GeoLite2 City database at `path`. Undefined when the file doesn't exist, so the
 * app runs without IP lookup until it's downloaded (`pnpm geolite2:update`); throws if the
 * file exists but can't be read.
 */
export async function openIpLocator(
  path: string,
  open: (path: string) => Promise<CityReader> = (file) => Reader.open(file),
): Promise<IpLocator | undefined> {
  if (!existsSync(path)) return undefined;
  return createIpLocator(await open(path));
}

/** Dual-stack sockets report IPv4 clients as IPv4-mapped IPv6 (`::ffff:1.2.3.4`). */
function normaliseIp(ip: string): string {
  return ip.startsWith('::ffff:') && ip.includes('.') ? ip.slice('::ffff:'.length) : ip;
}
