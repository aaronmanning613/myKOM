// The Strava client: the single place every Strava API call goes through.

export const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
export const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
export const STRAVA_DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';
export const STRAVA_ATHLETE_URL = 'https://www.strava.com/api/v3/athlete';

/** The scopes myKOM asks for. The Runner may untick some on Strava's consent screen. */
export const STRAVA_SCOPES = ['read', 'read_all', 'activity:read_all', 'profile:read_all'] as const;

/** Access tokens expiring within this window are refreshed before use. */
export const REFRESH_WINDOW_MS = 5 * 60 * 1000;

export class StravaError extends Error {
  constructor(
    message: string,
    /** HTTP status from Strava, or undefined when the request never got a response. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'StravaError';
  }
}

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
};

export type StravaClient = ReturnType<typeof createStravaClient>;

export function createStravaClient({
  clientId,
  clientSecret,
  tokenStore,
  fetch: fetchFn = globalThis.fetch,
  now = () => new Date(),
}: StravaClientOptions) {
  async function post(url: string, params: Record<string, string>): Promise<unknown> {
    return send(url, { method: 'POST', body: new URLSearchParams(params) });
  }

  async function send(url: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchFn(url, init);
    } catch (error) {
      throw new StravaError(`Strava request failed: ${(error as Error).message}`);
    }
    if (!res.ok) {
      throw new StravaError(`Strava responded ${res.status} to ${url}`, res.status);
    }
    try {
      return await res.json();
    } catch {
      throw new StravaError(`Strava sent an unreadable response from ${url}`, res.status);
    }
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
    const tokens = parseTokenSet(
      await requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    );
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
    async getValidAccessToken(runnerId: number): Promise<string> {
      const tokens = await tokenStore.load(runnerId);
      if (!tokens) throw new StravaError(`No Strava tokens for Runner ${runnerId}`);
      if (tokens.expiresAt.getTime() - now().getTime() > REFRESH_WINDOW_MS) {
        return tokens.accessToken;
      }
      return (await refresh(runnerId, tokens.refreshToken)).accessToken;
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
