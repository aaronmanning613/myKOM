// What every map in the app shares: its tiles, its height and how a Search Area circle looks.
// The main bundle imports this, so it must never import Leaflet as a value.

/** A map's height (Tailwind classes), shared with its loading placeholder so nothing shifts. */
export const MAP_HEIGHT_CLASSES = 'h-[260px] sm:h-[400px]';

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_MAX_ZOOM = 19;
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** The Search Area circle: grey and dashed, with no fill. */
export const SEARCH_AREA_COLOUR = '#6b7280';
export const SEARCH_AREA_DASH = '6 6';
