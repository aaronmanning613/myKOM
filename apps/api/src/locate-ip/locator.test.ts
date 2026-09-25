import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressNotFoundError, ValueError } from '@maxmind/geoip2-node';
import { describe, expect, it, vi } from 'vitest';
import { createIpLocator, openIpLocator, type CityReader } from './locator.js';

type City = ReturnType<CityReader['city']>;

/** A stand-in GeoLite2 reader whose `city()` returns the given (partial) record. */
function readerReturning(record: Partial<Record<keyof City, unknown>>) {
  return { city: vi.fn<CityReader['city']>(() => record as City) };
}

function readerThrowing(error: Error) {
  return {
    city: vi.fn<CityReader['city']>(() => {
      throw error;
    }),
  };
}

const names = (en: string) => ({ names: { en } });

const leedsRecord = {
  city: names('Leeds'),
  subdivisions: [names('England')],
  country: names('United Kingdom'),
  location: { latitude: 53.7974, longitude: -1.5438, accuracyRadius: 20 },
};

describe('createIpLocator', () => {
  it('maps a city record to a label, coordinates and accuracy', () => {
    const reader = readerReturning(leedsRecord);
    expect(createIpLocator(reader).locate('81.2.69.160')).toEqual({
      label: 'Leeds, England, United Kingdom',
      lat: 53.7974,
      lng: -1.5438,
      accuracyRadiusKm: 20,
    });
    expect(reader.city).toHaveBeenCalledWith('81.2.69.160');
  });

  it('labels a country-level match with the names it has, without repeats', () => {
    const reader = readerReturning({
      subdivisions: [names('Singapore')],
      country: names('Singapore'),
      location: { latitude: 1.3667, longitude: 103.8, accuracyRadius: 500 },
    });
    expect(createIpLocator(reader).locate('1.2.3.4')).toMatchObject({ label: 'Singapore' });
  });

  it('is null when the record has no location or no names', () => {
    expect(createIpLocator(readerReturning({ country: names('France') })).locate('1.2.3.4')).toBe(
      null,
    );
    expect(
      createIpLocator(
        readerReturning({ location: { latitude: 1, longitude: 2, accuracyRadius: 1000 } }),
      ).locate('1.2.3.4'),
    ).toBe(null);
  });

  it('is null for an address the database does not have, or an invalid one', () => {
    const notFound = readerThrowing(new AddressNotFoundError('127.0.0.1 is not in the database'));
    expect(createIpLocator(notFound).locate('127.0.0.1')).toBe(null);
    expect(createIpLocator(readerThrowing(new ValueError('bad'))).locate('nope')).toBe(null);
  });

  it('passes on unexpected reader errors', () => {
    const broken = readerThrowing(new Error('corrupt database'));
    expect(() => createIpLocator(broken).locate('1.2.3.4')).toThrow('corrupt database');
  });

  it('looks up IPv4-mapped IPv6 addresses as IPv4', () => {
    const reader = readerReturning(leedsRecord);
    createIpLocator(reader).locate('::ffff:81.2.69.160');
    expect(reader.city).toHaveBeenCalledWith('81.2.69.160');
    createIpLocator(reader).locate('2001:db8::1');
    expect(reader.city).toHaveBeenLastCalledWith('2001:db8::1');
  });
});

describe('openIpLocator', () => {
  it('is undefined when the database file is missing, without trying to open it', async () => {
    const open = vi.fn();
    const path = join(mkdtempSync(join(tmpdir(), 'mykom-geolite2-')), 'GeoLite2-City.mmdb');
    await expect(openIpLocator(path, open)).resolves.toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the database file when it exists', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mykom-geolite2-')), 'GeoLite2-City.mmdb');
    writeFileSync(path, '');
    const reader = readerReturning(leedsRecord);
    const locator = await openIpLocator(path, async () => reader);
    expect(locator?.locate('81.2.69.160')).toMatchObject({
      label: 'Leeds, England, United Kingdom',
    });
  });

  it('throws when the file exists but is not a GeoLite2 database', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mykom-geolite2-')), 'GeoLite2-City.mmdb');
    writeFileSync(path, 'not a database');
    await expect(openIpLocator(path)).rejects.toThrow();
  });
});
