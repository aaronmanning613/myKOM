// The shared Playwright `test` every spec uses. Tests never fetch map tiles: every request for an
// OpenStreetMap tile is answered with a bundled blank tile, and `tiles` records them so a spec can
// check none got past.
import { test as base, type Request } from '@playwright/test';
import { readFileSync } from 'node:fs';

export { expect } from '@playwright/test';
export type { APIRequestContext, Page } from '@playwright/test';

export const OSM_TILES = 'https://tile.openstreetmap.org/**';
const BLANK_TILE = readFileSync(new URL('./blank-tile.png', import.meta.url));

export type Tiles = {
  /** Every tile request the browser made. */
  requested: string[];
  /** The tile requests the fixture answered with the blank tile. */
  served: string[];
};

export const test = base.extend<{ tiles: Tiles }>({
  tiles: [
    async ({ context }, use) => {
      const tiles: Tiles = { requested: [], served: [] };
      context.on('request', (request: Request) => {
        if (new URL(request.url()).hostname === 'tile.openstreetmap.org') {
          tiles.requested.push(request.url());
        }
      });
      await context.route(OSM_TILES, (route) => {
        tiles.served.push(route.request().url());
        return route.fulfill({ contentType: 'image/png', body: BLANK_TILE });
      });
      await use(tiles);
    },
    { auto: true },
  ],
});
