import type { SearchProgress } from './results.js';

/** The radii a Runner can pick for a Mapped Area, in km. */
export const MAPPED_AREA_RADII_KM = [10, 25, 50] as const;

export type MappedAreaRadiusKm = (typeof MAPPED_AREA_RADII_KM)[number];

/** The radius picked before the Runner has chosen one. */
export const DEFAULT_MAPPED_AREA_RADIUS_KM: MappedAreaRadiusKm = 25;

/** The body of `POST /api/mapped-areas`: an area to fill in gradually in the background. */
export type MappedAreaCreate = {
  /** What the Runner sees, e.g. the place name they picked. */
  label: string;
  lat: number;
  lng: number;
  radiusKm: MappedAreaRadiusKm;
};

/** How far a Mapped Area's crawl has got. */
export type MappedAreaProgress = SearchProgress & {
  /** The share of the area's ground crossed by the Runner's runs that has been checked (0-1). */
  coverage: number;
};

/** A Mapped Area with its progress. */
export type MappedArea = MappedAreaCreate & {
  id: number;
  /** ISO 8601. */
  createdAt: string;
  progress: MappedAreaProgress;
};

/** What `GET /api/mapped-areas` returns: the Runner's Mapped Areas, newest first. */
export type MappedAreasResponse = {
  mappedAreas: MappedArea[];
};
