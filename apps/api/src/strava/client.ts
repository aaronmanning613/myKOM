// The Strava client: the single place every Strava API call goes through. Responses are mapped
// to our own shapes here, so no raw Strava JSON gets any further.

import { boundingBoxOf, decodePolyline, type BoundingBox, type LatLng } from '@mykom/shared';

export const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
export const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
export const STRAVA_DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';
export const STRAVA_API_URL = 'https://www.strava.com/api/v3';
export const STRAVA_ATHLETE_URL = `${STRAVA_API_URL}/athlete`;

/** Items per page for the paged reads (Strava's maximum), so a full activity list costs fewest reads. */
export const STRAVA_PAGE_SIZE = 200;

/** The scopes myKOM asks for. The Runner may untick some on Strava's consent screen. */
export const STRAVA_SCOPES = ['read', 'read_all', 'activity:read_all', 'profile:read_all'] as const;

/** Access tokens expiring within this window are refreshed before use. */
export const REFRESH_WINDOW_MS = 5 * 60 * 1000;

export class StravaError extends Error {
  constructor(
    message: string,
    /** HTTP status from Strava, or undefined when the request never got a response. */
    readonly status?: number,
    /** Strava's error body, when it sent a readable one. */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'StravaError';
  }
}

/** Strava's rate limit was hit (429). Try again at `retryAt`. */
export class StravaRateLimitError extends StravaError {
  constructor(
    message: string,
    readonly retryAt: Date,
    readonly rateLimits: StravaRateLimits,
  ) {
    super(message, 429);
    this.name = 'StravaRateLimitError';
  }
}

/**
 * The Runner has revoked myKOM's access: the refresh token was rejected, or Strava refused a
 * read with 401. The caller should delete the Runner as Disconnect does.
 */
export class StravaRevokedError extends StravaError {
  constructor(
    message: string,
    readonly runnerId: number,
    status: number,
    body?: unknown,
  ) {
    super(message, status, body);
    this.name = 'StravaRevokedError';
  }
}

/** One of Strava's two rate-limit windows: the current 15 minutes, and the UTC day. */
export type StravaRateLimitPair = { window: number; day: number };

/**
 * Strava's `x-ratelimit-*` (every request) and `x-readratelimit-*` (reads) headers, or null when
 * a pair is missing.
 */
export type StravaRateLimits = {
  overall: { limit: StravaRateLimitPair; usage: StravaRateLimitPair } | null;
  read: { limit: StravaRateLimitPair; usage: StravaRateLimitPair } | null;
};

/** A read's mapped result, with the rate-limit usage Strava reported alongside it. */
export type StravaRead<T> = { data: T; rateLimits: StravaRateLimits };

/** A run (or other activity) from the activity list. */
export type StravaActivitySummary = {
  id: number;
  name: string;
  sportType: string;
  /** ISO 8601 start time. */
  startDate: string;
  /** Metres. */
  distance: number;
  /** Seconds. */
  movingTime: number;
  /** Null for an activity without GPS (e.g. a treadmill run). */
  summaryPolyline: string | null;
  bbox: BoundingBox | null;
};

/** A Segment as embedded in an effort or the starred list. Grades are percent, as Strava sends them. */
export type StravaSegmentSummary = {
  id: number;
  name: string;
  activityType: string | null;
  /** Metres. */
  distance: number;
  averageGrade: number | null;
  maximumGrade: number | null;
  elevationHigh: number | null;
  elevationLow: number | null;
  start: LatLng;
  end: LatLng | null;
  hazardous: boolean;
};

export type StravaSegmentEffort = {
  /** Effort ids are past Number.MAX_SAFE_INTEGER, so they're kept as decimal strings. */
  id: string;
  activityId: number;
  /** Seconds. */
  elapsedTime: number;
  /** ISO 8601. */
  startDate: string;
  /** The effort's place in the overall top 10 when it was run: a stale top-10 hint. */
  komRank: number | null;
  /** The effort carried an `overall` / `overall_cr` achievement. */
  recordAchievement: boolean;
  segment: StravaSegmentSummary;
};

export type StravaActivityDetail = StravaActivitySummary & { efforts: StravaSegmentEffort[] };

export type StravaSegmentDetail = StravaSegmentSummary & {
  /** Metres. */
  totalElevationGain: number | null;
  polyline: string | null;
  /** Impressiveness. */
  athleteCount: number | null;
  /** The Target Records' display strings (e.g. "58s", "1:27"); null when Strava sent none. */
  xoms: { kom: string | null; qom: string | null } | null;
  /** The requesting Runner's own stats on the Segment, when Strava includes them. */
  athleteStats: { prElapsedTime: number | null; prDate: string | null } | null;
};

export type StravaTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

/** The athlete summary Strava returns alongside a code exchange. */
export type StravaAthlete = {
  id: number;
  firstName: string;
  sex: 'M' | 'F' | null;
  avatarUrl: string | null;
  isSubscriber: boolean;
};

export type StravaCodeExchange = StravaTokenSet & { athlete: StravaAthlete };

/** Where the client reads and saves a Runner's tokens. */
export type StravaTokenStore = {
  load(runnerId: number): Promise<StravaTokenSet | undefined>;
  save(runnerId: number, tokens: StravaTokenSet): Promise<void>;
};

export type StravaClientOptions = {
  clientId: string;
  clientSecret: string;
  tokenStore: StravaTokenStore;
  fetch?: typeof fetch;
  now?: () => Date;
  /**
   * Runs before a StravaRevokedError is thrown for a Runner, so revoking myKOM on strava.com
   * deletes their data like Disconnect does, whichever call notices it first.
   */
  onRevoked?: (runnerId: number) => Promise<void>;
};

export type StravaClient = ReturnType<typeof createStravaClient>;

export function createStravaClient({
  clientId,
  clientSecret,
  tokenStore,
  fetch: fetchFn = globalThis.fetch,
  now = () => new Date(),
  onRevoked,
}: StravaClientOptions) {
  async function revoked(error: StravaRevokedError): Promise<StravaRevokedError> {
    await onRevoked?.(error.runnerId);
    return error;
  }

  async function post(url: string, params: Record<string, string>): Promise<unknown> {
    return send(url, { method: 'POST', body: new URLSearchParams(params) });
  }

  async function send(url: string, init: RequestInit): Promise<unknown> {
    return (await request(url, init)).body;
  }

  async function request(
    url: string,
    init: RequestInit,
  ): Promise<{ body: unknown; rateLimits: StravaRateLimits }> {
    let res: Response;
    let text: string;
    try {
      res = await fetchFn(url, init);
      text = await res.text();
    } catch (error) {
      throw new StravaError(`Strava request failed: ${(error as Error).message}`);
    }
    const body = parseJson(text);
    const rateLimits = parseRateLimits(res.headers);
    if (res.status === 429) {
      throw new StravaRateLimitError(
        `Strava's rate limit was hit on ${url}`,
        retryAtFor(rateLimits, now()),
        rateLimits,
      );
    }
    if (!res.ok) {
      throw new StravaError(`Strava responded ${res.status} to ${url}`, res.status, body);
    }
    if (body === undefined) {
      throw new StravaError(`Strava sent an unreadable response from ${url}`, res.status);
    }
    return { body, rateLimits };
  }

  /** An authenticated API read for the Runner, mapped by `map`. A 401 means access was revoked. */
  async function read<T>(
    runnerId: number,
    path: string,
    map: (body: unknown) => T,
  ): Promise<StravaRead<T>> {
    const accessToken = await getValidAccessToken(runnerId);
    try {
      const { body, rateLimits } = await request(`${STRAVA_API_URL}${path}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      return { data: map(body), rateLimits };
    } catch (error) {
      if (error instanceof StravaError && error.status === 401 && !isMissingScope(error.body)) {
        throw await revoked(
          new StravaRevokedError(
            `Strava refused Runner ${runnerId}'s access token`,
            runnerId,
            401,
            error.body,
          ),
        );
      }
      throw error;
    }
  }

  async function getValidAccessToken(runnerId: number): Promise<string> {
    const tokens = await tokenStore.load(runnerId);
    if (!tokens) throw new StravaError(`No Strava tokens for Runner ${runnerId}`);
    if (tokens.expiresAt.getTime() - now().getTime() > REFRESH_WINDOW_MS) {
      return tokens.accessToken;
    }
    return (await refresh(runnerId, tokens.refreshToken)).accessToken;
  }

  async function requestTokens(params: Record<string, string>): Promise<Record<string, unknown>> {
    const body = await post(STRAVA_TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      ...params,
    });
    if (!isRecord(body)) throw new StravaError('Strava sent an unexpected token response');
    return body;
  }

  async function refresh(runnerId: number, refreshToken: string): Promise<StravaTokenSet> {
    let body: Record<string, unknown>;
    try {
      body = await requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken });
    } catch (error) {
      if (error instanceof StravaError && isRejectedRefreshToken(error)) {
        throw await revoked(
          new StravaRevokedError(
            `Strava rejected Runner ${runnerId}'s refresh token`,
            runnerId,
            error.status!,
            error.body,
          ),
        );
      }
      throw error;
    }
    const tokens = parseTokenSet(body);
    await tokenStore.save(runnerId, tokens);
    return tokens;
  }

  return {
    /** The URL that sends the Runner to Strava's consent screen. */
    authorizeUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
      const url = new URL(STRAVA_AUTHORIZE_URL);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        approval_prompt: 'auto',
        scope: STRAVA_SCOPES.join(','),
        state,
      }).toString();
      return url.toString();
    },

    /** Exchanges the code from Strava's callback for tokens and the athlete summary. */
    async exchangeCode(code: string): Promise<StravaCodeExchange> {
      const body = await requestTokens({ grant_type: 'authorization_code', code });
      return { ...parseTokenSet(body), athlete: parseAthlete(body.athlete) };
    },

    /** The Runner's access token, refreshed and saved first if it expires within 5 minutes. */
    getValidAccessToken,

    /**
     * One page of the Runner's activity list (`GET /athlete/activities`), newest first, only
     * those started after `after` when given. A page shorter than STRAVA_PAGE_SIZE is the last.
     */
    listActivities(
      runnerId: number,
      { after, page }: { after?: Date; page: number },
    ): Promise<StravaRead<StravaActivitySummary[]>> {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(STRAVA_PAGE_SIZE),
      });
      // Strava's `after` is epoch seconds.
      if (after) params.set('after', String(Math.floor(after.getTime() / 1000)));
      return read(runnerId, `/athlete/activities?${params}`, (body) =>
        listOf(body, 'activity list').map(parseActivitySummary),
      );
    },

    /** A DetailedActivity (`GET /activities/{id}`) with every Segment effort, hidden ones included. */
    getActivity(runnerId: number, activityId: number): Promise<StravaRead<StravaActivityDetail>> {
      return read(runnerId, `/activities/${activityId}?include_all_efforts=true`, (body) => {
        const summary = parseActivitySummary(body);
        const efforts =
          isRecord(body) && Array.isArray(body.segment_efforts) ? body.segment_efforts : [];
        return { ...summary, efforts: efforts.map(parseEffort) };
      });
    },

    /**
     * A Segment's details (`GET /segments/{id}`), with its `xoms` Target Records and the Runner's
     * own `athlete_segment_stats`. The holders' names and `local_legend` are dropped.
     */
    getSegment(runnerId: number, segmentId: number): Promise<StravaRead<StravaSegmentDetail>> {
      return read(runnerId, `/segments/${segmentId}`, parseSegmentDetail);
    },

    /** One page of the Runner's starred Segments (`GET /segments/starred`). */
    getStarredSegments(
      runnerId: number,
      page: number,
    ): Promise<StravaRead<StravaSegmentSummary[]>> {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(STRAVA_PAGE_SIZE),
      });
      return read(runnerId, `/segments/starred?${params}`, (body) =>
        listOf(body, 'starred Segment list').map(parseSegmentSummary),
      );
    },

    /** The signed-in athlete (`GET /athlete`), mapped the same way as on a code exchange. */
    async getAthlete(accessToken: string): Promise<StravaAthlete> {
      const body = await send(STRAVA_ATHLETE_URL, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      return parseAthlete(body);
    },

    /** Revokes myKOM's access to the athlete's Strava account. */
    async deauthorize(accessToken: string): Promise<void> {
      await post(STRAVA_DEAUTHORIZE_URL, { access_token: accessToken });
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * JSON.parse, except `id`s too big for a double (Segment effort ids) are read as strings rather
 * than silently rounded. Undefined when the text isn't JSON.
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/("id"\s*:\s*)(\d{16,})/g, '$1"$2"'));
  } catch {
    return undefined;
  }
}

function parseRateLimitPair(value: string | null): StravaRateLimitPair | null {
  const match = value?.match(/^\s*(\d+)\s*,\s*(\d+)\s*$/);
  return match ? { window: Number(match[1]), day: Number(match[2]) } : null;
}

export function parseRateLimits(headers: Headers): StravaRateLimits {
  const pair = (prefix: string) => {
    const limit = parseRateLimitPair(headers.get(`${prefix}-limit`));
    const usage = parseRateLimitPair(headers.get(`${prefix}-usage`));
    return limit && usage ? { limit, usage } : null;
  };
  return { overall: pair('x-ratelimit'), read: pair('x-readratelimit') };
}

const QUARTER_HOUR_MS = 15 * 60 * 1000;

/**
 * When a rate-limited request may be retried: Strava's 15-minute windows start on the quarter
 * hour, and its day at midnight UTC. The next day when a daily limit is used up.
 */
function retryAtFor(limits: StravaRateLimits, now: Date): Date {
  const dayUsedUp = [limits.overall, limits.read].some(
    (pair) => pair !== null && pair.usage.day >= pair.limit.day,
  );
  if (dayUsedUp) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  }
  return new Date((Math.floor(now.getTime() / QUARTER_HOUR_MS) + 1) * QUARTER_HOUR_MS);
}

function stravaErrors(body: unknown): Record<string, unknown>[] {
  return isRecord(body) && Array.isArray(body.errors) ? body.errors.filter(isRecord) : [];
}

/**
 * A refresh the athlete's revocation explains: OAuth's `invalid_grant`, or Strava's own errors
 * naming the refresh token. A rejected client id or secret is our fault, not a revocation, so
 * it must never delete a Runner.
 */
function isRejectedRefreshToken(error: StravaError): boolean {
  if (error.status !== 400 && error.status !== 401) return false;
  const body = error.body;
  if (isRecord(body) && body.error === 'invalid_grant') return true;
  return stravaErrors(body).some(
    (e) => (e.field === 'refresh_token' || e.resource === 'RefreshToken') && e.code === 'invalid',
  );
}

/** A 401 for a scope the Runner didn't grant (e.g. `activity:read_permission` missing), not a revocation. */
function isMissingScope(body: unknown): boolean {
  return stravaErrors(body).some(
    (e) => typeof e.field === 'string' && e.field.endsWith('_permission') && e.code === 'missing',
  );
}

function listOf(body: unknown, what: string): unknown[] {
  if (!Array.isArray(body)) throw new StravaError(`Strava sent an unexpected ${what}`);
  return body;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function latLngOf(value: unknown): LatLng | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [lat, lng] = value;
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
}

function parseActivitySummary(value: unknown): StravaActivitySummary {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    typeof value.start_date !== 'string' ||
    typeof value.distance !== 'number' ||
    typeof value.moving_time !== 'number'
  ) {
    throw new StravaError('Strava sent an unexpected activity');
  }
  const summaryPolyline = isRecord(value.map) ? stringOrNull(value.map.summary_polyline) : null;
  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    // `type` is the older field; `sport_type` is set on every current activity.
    sportType: stringOrNull(value.sport_type) ?? stringOrNull(value.type) ?? '',
    startDate: value.start_date,
    distance: value.distance,
    movingTime: value.moving_time,
    summaryPolyline,
    bbox: summaryPolyline ? boundingBoxOf(decodePolyline(summaryPolyline)) : null,
  };
}

function parseSegmentSummary(value: unknown): StravaSegmentSummary {
  const start = isRecord(value) ? latLngOf(value.start_latlng) : null;
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    typeof value.distance !== 'number' ||
    !start
  ) {
    throw new StravaError('Strava sent an unexpected Segment');
  }
  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    activityType: stringOrNull(value.activity_type),
    distance: value.distance,
    averageGrade: numberOrNull(value.average_grade),
    maximumGrade: numberOrNull(value.maximum_grade),
    elevationHigh: numberOrNull(value.elevation_high),
    elevationLow: numberOrNull(value.elevation_low),
    start,
    end: latLngOf(value.end_latlng),
    hazardous: value.hazardous === true,
  };
}

const RECORD_ACHIEVEMENTS = new Set(['overall', 'overall_cr']);

function parseEffort(value: unknown): StravaSegmentEffort {
  const id = isRecord(value) ? value.id : undefined;
  if (
    !isRecord(value) ||
    (typeof id !== 'string' && typeof id !== 'number') ||
    !isRecord(value.activity) ||
    typeof value.activity.id !== 'number' ||
    typeof value.elapsed_time !== 'number' ||
    typeof value.start_date !== 'string'
  ) {
    throw new StravaError('Strava sent an unexpected Segment effort');
  }
  const achievements = Array.isArray(value.achievements) ? value.achievements : [];
  return {
    id: String(id),
    activityId: value.activity.id,
    elapsedTime: value.elapsed_time,
    startDate: value.start_date,
    komRank: numberOrNull(value.kom_rank),
    recordAchievement: achievements.some(
      (a) => isRecord(a) && typeof a.type === 'string' && RECORD_ACHIEVEMENTS.has(a.type),
    ),
    segment: parseSegmentSummary(value.segment),
  };
}

function parseSegmentDetail(value: unknown): StravaSegmentDetail {
  const summary = parseSegmentSummary(value);
  const body = value as Record<string, unknown>;
  const { xoms, athlete_segment_stats: stats } = body;
  return {
    ...summary,
    totalElevationGain: numberOrNull(body.total_elevation_gain),
    polyline: isRecord(body.map) ? stringOrNull(body.map.polyline) : null,
    athleteCount: numberOrNull(body.athlete_count),
    // Only the times: `xoms` never carries a name, but `local_legend` (dropped) does.
    xoms: isRecord(xoms) ? { kom: stringOrNull(xoms.kom), qom: stringOrNull(xoms.qom) } : null,
    athleteStats: isRecord(stats)
      ? {
          prElapsedTime: numberOrNull(stats.pr_elapsed_time),
          prDate: stringOrNull(stats.pr_date),
        }
      : null,
  };
}

function parseTokenSet(body: Record<string, unknown>): StravaTokenSet {
  const { access_token, refresh_token, expires_at } = body;
  if (
    typeof access_token !== 'string' ||
    typeof refresh_token !== 'string' ||
    typeof expires_at !== 'number'
  ) {
    throw new StravaError('Strava sent an unexpected token response');
  }
  // Strava's expires_at is in epoch seconds.
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: new Date(expires_at * 1000),
  };
}

function parseAthlete(athlete: unknown): StravaAthlete {
  if (!isRecord(athlete) || typeof athlete.id !== 'number') {
    throw new StravaError('Strava sent no athlete');
  }
  const { id, firstname, sex, profile, summit, premium } = athlete;
  return {
    id,
    firstName: typeof firstname === 'string' ? firstname : '',
    sex: sex === 'M' || sex === 'F' ? sex : null,
    // Strava sends a relative placeholder path (e.g. "avatar/athlete/large.png") when there's no photo.
    avatarUrl: typeof profile === 'string' && /^https?:\/\//.test(profile) ? profile : null,
    isSubscriber: summit === true || premium === true,
  };
}
