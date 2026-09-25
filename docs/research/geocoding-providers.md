# Geocoding and IP-location providers

Research for [issue #6](https://github.com/aaronmanning613/myKOM/issues/6), part of the [map in issue #1](https://github.com/aaronmanning613/myKOM/issues/1).

**Question.** Which geocoding (place name / postcode → lat-lng) and IP-geolocation providers suit a small-group Node.js app? How do their free tiers, rate limits and terms compare (caching, attribution, commercial use, use on non-provider maps), how good is global postcode coverage, and is "browser Geolocation API with IP fallback" the right combination for the Search Area centre?

Sources are the providers' own pages, fetched 2026-09-25. Anything marked **unverified** could not be confirmed on a primary source.

## Context

A Search Area is a centre point (from a place name, postcode or the Runner's location) plus a radius from a fixed set (see `CONTEXT.md`). myKOM is for a handful of Runners, so the app will make very few geocoding calls: one per Search Area change. What matters most is the terms of use (can we store the centre point, can we show it on whatever map we pick, is the free tier allowed in production), not raw throughput.

## Geocoding providers

| Provider | Free tier | Rate limit | Free tier OK in production? | Storing results | Must results go on the provider's map? | Attribution |
|---|---|---|---|---|---|---|
| **Nominatim (public OSMF server)** | Free, no key | Max 1 request/second [1] | Yes, for normal app use. Not for services "whose primary function is related to geocoding" [1] | Caching required for bulk use, "strongly encouraged" otherwise [1]. Results can be stored with other data without share-alike [2] | No. OSM geocoding results may be used with non-OSM data and maps [2] | OSM/ODbL attribution required [1][2] |
| **Photon (photon.komoot.io)** | Free, no key | Not stated. "extensive usage will be throttled" [3] | No guarantee: "We do not guarantee for the availability" [3] | Not stated (**unverified**). Data is OSM [3], so the OSMF guideline [2] likely applies | Not stated (**unverified**) | Not stated on the page. OSM attribution presumably applies (**unverified**) |
| **LocationIQ** | 5,000 requests/day [4] | 2/second, 60/minute [4] | Yes, with a prominent "Search by LocationIQ.com" link [4] | "You can store response data forever. If you have a free account, you can cache API request-response pairs for upto 48 hours." [4] | No restriction found (**unverified**) | Link back required on the free plan [4] |
| **Geoapify** | 3,000 credits/day [5] | Up to 5/second [5] | Yes: "including in production" [5] | "Cache/store results with no limits" [6] | No restriction found (**unverified**) | Geoapify attribution on the free plan, plus OSM attribution [5][7] |
| **OpenCage** | 2,500/day trial [8] | 1/second [8] | **No**: the trial is "for testing" and production users "should become a paying customer" [8] | Trial results may be kept permanently [8] | No restriction mentioned [8]. OSM-based [9] | OSM/ODbL [9] |
| **Mapbox Geocoding** | 100,000/month free for temporary geocoding. Permanent geocoding has no free tier ($5.00 per 1,000) [10] | 1,000/minute default [11] | Yes | Temporary results "are not allowed to be cached". Permanent storage needs `permanent=true` and a card on file [11] | **Yes**: "You may only use responses from the Geocoding API in conjunction with a Mapbox map." [11] | Mapbox |
| **Google Geocoding** | 10,000 free events/month (Essentials), then $5.00 per 1,000 [12] | n/a | Yes (billing account needed) | Lat/lng may be cached for at most "30 consecutive calendar days, after which Customer must delete" them. Place IDs may be stored indefinitely [13][14] | **Yes**: "Customer will not use the Google Maps Core Services with or near a non-Google Map" [15] | Google Maps logo or text, with strict styling rules [14] |
| **postcodes.io** | Free [16] | Not stated (**unverified**) | Yes (**unverified**: no terms page read) | Not stated | No | Data from Ordnance Survey and ONS open data [16] |

### Notes on the table

- **Nominatim has no autocomplete.** The policy forbids building one on top of the public API: "you must not implement such a service on the client side using the API" [1]. It also needs a User-Agent or Referer that identifies the app, and library defaults do not count [1]. For myKOM this means the Runner types a place and then submits it. Calls should go through our Node backend, which sets its own User-Agent and caches results.
- **Photon** is the OSM geocoder built for search-as-you-type, but the public instance comes with no service promise [3]. Treat it as a nice extra, not a dependency.
- **Mapbox and Google tie you to their maps.** Both forbid showing results on another provider's map [11][15]. Mapbox's free tier also forbids caching [11], and Google allows only 30 days [13]. Storing a Runner's saved Search Area centre in Postgres would therefore break Mapbox's temporary-tier terms and need a 30-day purge under Google. Neither fits unless the map is also theirs.
- **ipapi and ip-api** are IP providers; see the next section.

### Global postcode coverage

- All of the OSM-based providers (Nominatim, Photon, LocationIQ, Geoapify, OpenCage) are only as good as OSM's postcode data. Nominatim works out postcode centroids "mainly … from the OSM data itself" and can be supplemented with per-country external postcode files [17]. So coverage varies by country. The per-country quality of the public server was **not verified** on a primary source. Test the postcodes the actual Runners use.
- OpenCage lists postcodes.io among its extra data sources [9], which suggests better UK coverage there (**unverified** for other countries).
- **postcodes.io is UK only** [16]. It is free, backed by OS/ONS open data, and returns lat/lng directly (e.g. `GET https://api.postcodes.io/postcodes/SW1A1AA` → `51.50101, -0.141563`, tested live). If the Runners are UK-based, it is a reliable way to resolve postcodes.
- Google and Mapbox both support postcodes [11][12], but their terms rule them out anyway (see above).

## IP-geolocation providers

| Provider | Free tier | Granularity | Commercial / production | HTTPS on free | Notes |
|---|---|---|---|---|---|
| **MaxMind GeoLite2 City (local database)** | Free database with an account and licence key. 30 downloads/day. Web service: 1,000 lookups/day [18] | City, given as lat/lng plus an **accuracy radius** [18] | Allowed for "internal business purposes" [19] | n/a (local lookup) | Attribution required: "This product includes GeoLite Data created by MaxMind…" [19]. Old versions must be deleted within 30 days of a new release [19]. MaxMind itself says it is "considerably less accurate" than paid GeoIP [18]. Node reader: `@maxmind/geoip2-node` [20] |
| **ipinfo Lite** | Unlimited [21] | **Country only** [21] | Allowed, with attribution [21] | Yes (**unverified**) | Country-level data is too coarse to centre a Search Area |
| **ip-api.com (free)** | 45 requests/minute per IP [22] | City | **No**: "We do not allow commercial use of this endpoint" [22] | **No**: SSL "is not available for this free API" [22] | Can't be called from an HTTPS page (mixed content). Server-side use is limited to non-commercial [22][23] |
| **ipapi.co (free)** | 1,000/day [24] | City (**unverified** for the free plan) | **No**: "not meant for use in production" [24] | Paid plans list HTTPS/SSL [24] (free plan **unverified**) | Only for testing |

### How accurate is IP location?

- MaxMind's own example shows a **100 km** accuracy radius for city-level data. It also says IP geolocation "is never precise enough to identify or locate a specific household, individual, or street address" [25].
- Mobile-carrier IPs "may be used by mobile phones across a large distance". For those, MaxMind leaves out city data entirely and returns only country and region [25].
- For a VPN or proxy, MaxMind locates the exit server, not the user [25].
- The GeoLite EULA forbids using the data "for the purpose of identifying or locating a specific household, individual, or street address" [19]. Using it to pick a rough Search Area centre is fine.

## Browser Geolocation API

- **Needs a secure context.** It works only over HTTPS [26][27]. `http://localhost` and `127.0.0.1` count as secure, so local development works [28].
- **Asks for permission.** `getCurrentPosition()` triggers a browser prompt. The permission state is `granted`, `denied` or `prompt` [26]. Iframes need `Permissions-Policy: geolocation` and `allow="geolocation"` [26].
- **Reports its accuracy.** `coords.accuracy` is in metres at 95% confidence [29].
- **Options** [27]:
  - `enableHighAccuracy`: default `false`. Coarse location is enough for a Search Area centre.
  - `timeout`: default `Infinity`. **Set a finite timeout**, or the IP fallback may never fire.
  - `maximumAge`: default `0`. Accepting a cached fix of a few minutes speeds things up.
- **Error codes** [30]:
  - `1 PERMISSION_DENIED`, `2 POSITION_UNAVAILABLE` and `3 TIMEOUT`.
  - All three should trigger the IP fallback.
- **May not work in China**, because of Wi-Fi location restrictions [26].

### Is "browser location with IP fallback" the right pairing?

Yes, as long as the IP result is treated as approximate:

1. Browser location is the primary source. It is usually far more precise, and its `accuracy` field says exactly how precise.
2. IP location (e.g. 100 km radius [25]) can be as coarse as, or coarser than, the Search Area radii. If it is used silently, a Runner could get Segments from a nearby city. Show the resolved place name and let the Runner confirm or correct it (e.g. by typing a postcode). Mobile users may get only a region, with no city [25].
3. The IP lookup has to happen **on the server**, from the request's client IP. A browser-side call to a third-party IP API would need a provider that allows HTTPS and production use, which rules out the free ip-api and ipapi tiers [22][24]. If the backend runs behind a reverse proxy or PaaS load balancer, it must read the forwarded client IP correctly (this depends on the host, **not researched here**).

## Implications for myKOM

**Recommended pairing:**

- **Geocoding: Nominatim (public OSMF server), called from the Node backend.**
  - The small-group traffic is far below the 1 request/second limit.
  - It is free, needs no key, and allows storing results and showing them on any map [1][2].
  - Requirements: send a descriptive User-Agent, cache every query→result pair in Postgres, show OSM attribution, and **don't autocomplete** (submit on Enter).
  - Optionally send UK-format postcodes to postcodes.io first.
- **Geocoding fallback: LocationIQ or Geoapify free tier.**
  - Both are OSM-based, allowed in production with attribution, and not tied to a map [4][5].
  - Geoapify's "store with no limits" [6] is simpler than LocationIQ's 48-hour cache rule for request-response pairs [4].
  - Either could replace Nominatim if autocomplete becomes a requirement. Their autocomplete terms were **not verified** here.
- **IP fallback: MaxMind GeoLite2 City, read locally with `@maxmind/geoip2-node`.**
  - No per-request third-party calls and no rate limit. Commercial internal use is allowed [19].
  - It needs a free MaxMind account and licence key, a scheduled `geoipupdate` refresh (old databases must be deleted within 30 days [19]), and an attribution line.
- **Avoid:**
  - **Google and Mapbox**: their results can't go on a non-Google or non-Mapbox map, and caching is restricted.
  - **OpenCage free trial and ipapi.co free**: not allowed in production.
  - **ip-api free**: non-commercial and HTTP only.
  - **ipinfo Lite**: country-level only.

**Things that may reshape the map (issue #1):**

- **The map library choice is now tied to geocoding terms.** Picking Mapbox GL or Google Maps for the results view would change the geocoder decision, and the other way round. If the results view gets a map, OSM-based tiles (Leaflet or MapLibre with an OSM-derived tile source) keep everything consistent. Tile terms were not researched here.
- **No autocomplete with Nominatim.** The place search UX is submit-then-pick-from-results, not type-ahead.
- **IP fallback is coarse** (tens to 100+ km). "Use my location" via IP should show the resolved place for the Runner to confirm, not search silently.
- **Hosting items:** HTTPS is mandatory in production (for the Geolocation API). IP fallback needs correct client-IP forwarding behind the host's proxy. GeoLite2 needs a periodic update job and a licence-key secret. These belong with the "Hosting and deployment" item.

## Sources

1. OSMF Nominatim Usage Policy: https://operations.osmfoundation.org/policies/nominatim/
2. OSMF Geocoding Guideline: https://osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline
3. Photon public API page: https://photon.komoot.io/
4. LocationIQ pricing / FAQ: https://locationiq.com/pricing
5. Geoapify pricing / FAQ: https://www.geoapify.com/pricing/
6. Geoapify forward geocoding docs: https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/
7. Geoapify terms and conditions: https://www.geoapify.com/term-and-conditions/
8. OpenCage pricing / free trial FAQ: https://opencagedata.com/pricing
9. OpenCage credits (data sources): https://opencagedata.com/credits
10. Mapbox pricing: https://www.mapbox.com/pricing
11. Mapbox Geocoding API docs: https://docs.mapbox.com/api/search/geocoding/
12. Google Maps Platform pricing list: https://developers.google.com/maps/billing-and-pricing/pricing
13. Google Maps Platform Service Specific Terms (Geocoding lat/lng caching, 30 days): https://cloud.google.com/maps-platform/terms/maps-service-terms
14. Google Geocoding API policies (place ID exemption, attribution): https://developers.google.com/maps/documentation/geocoding/policies
15. Google Maps Platform Terms, "No Use With Non-Google Maps": https://cloud.google.com/maps-platform/terms
16. postcodes.io: https://postcodes.io/ (live check: https://api.postcodes.io/postcodes/SW1A1AA)
17. Nominatim docs, Postcodes: https://nominatim.org/release-docs/latest/customize/Postcodes/
18. MaxMind GeoLite2 free geolocation data: https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/
19. MaxMind GeoLite EULA: https://www.maxmind.com/en/geolite2/eula
20. MaxMind database client docs: https://dev.maxmind.com/geoip/geolocate-an-ip/databases/
21. IPinfo pricing: https://ipinfo.io/pricing
22. ip-api JSON endpoint docs: https://ip-api.com/docs/api:json
23. ip-api legal: https://ip-api.com/docs/legal
24. ipapi.co pricing: https://ipapi.co/pricing/
25. MaxMind, Geolocation Accuracy: https://support.maxmind.com/hc/en-us/articles/4407630607131-Geolocation-Accuracy
26. MDN, Geolocation API: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API
27. MDN, getCurrentPosition(): https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition
28. MDN, Secure contexts: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts
29. MDN, GeolocationCoordinates.accuracy: https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/accuracy
30. MDN, GeolocationPositionError.code: https://developer.mozilla.org/en-US/docs/Web/API/GeolocationPositionError/code
