import { describe, expect, it, vi } from 'vitest';
import {
  STRAVA_DEAUTHORIZE_URL,
  STRAVA_TOKEN_URL,
  StravaError,
  createStravaClient,
  type StravaTokenSet,
} from './client.js';

const NOW = new Date('2026-09-25T12:00:00Z');
const nowSeconds = NOW.getTime() / 1000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(stored?: StravaTokenSet) {
  const tokens = new Map<number, StravaTokenSet>();
  if (stored) tokens.set(1, stored);
  const tokenStore = {
    load: vi.fn(async (runnerId: number) => tokens.get(runnerId)),
    save: vi.fn(async (runnerId: number, set: StravaTokenSet) => {
      tokens.set(runnerId, set);
    }),
  };
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = createStravaClient({
    clientId: '123',
    clientSecret: 'shh',
    tokenStore,
    fetch,
    now: () => NOW,
  });
  return { client, fetch, tokenStore, tokens };
}

function sentParams(fetch: ReturnType<typeof setup>['fetch'], call = 0) {
  const [url, init] = fetch.mock.calls[call]!;
  return { url, method: init?.method, params: Object.fromEntries(init?.body as URLSearchParams) };
}

describe('authorizeUrl', () => {
  it('asks for the read scopes with approval_prompt=auto and the given state', () => {
    const { client } = setup();
    const url = new URL(
      client.authorizeUrl({ redirectUri: 'http://localhost:5173/cb', state: 'abc' }),
    );
    expect(url.origin + url.pathname).toBe('https://www.strava.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '123',
      redirect_uri: 'http://localhost:5173/cb',
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'read,read_all,activity:read_all,profile:read_all',
      state: 'abc',
    });
  });
});

describe('exchangeCode', () => {
  it('exchanges a code for tokens and the athlete summary', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      jsonResponse({
        token_type: 'Bearer',
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_at: nowSeconds + 21600,
        expires_in: 21600,
        athlete: {
          id: 9876543210,
          firstname: 'Paula',
          sex: 'F',
          profile: 'https://dgalywyr863hv.cloudfront.net/pictures/athletes/1/large.jpg',
          summit: true,
        },
      }),
    );

    await expect(client.exchangeCode('the-code')).resolves.toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: new Date((nowSeconds + 21600) * 1000),
      athlete: {
        id: 9876543210,
        firstName: 'Paula',
        sex: 'F',
        avatarUrl: 'https://dgalywyr863hv.cloudfront.net/pictures/athletes/1/large.jpg',
        isSubscriber: true,
      },
    });
    expect(sentParams(fetch)).toEqual({
      url: STRAVA_TOKEN_URL,
      method: 'POST',
      params: {
        client_id: '123',
        client_secret: 'shh',
        grant_type: 'authorization_code',
        code: 'the-code',
      },
    });
  });

  it('treats a missing sex and placeholder avatar as unknown', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      jsonResponse({
        access_token: 'a',
        refresh_token: 'r',
        expires_at: nowSeconds + 3600,
        athlete: { id: 5, firstname: 'Sam', sex: null, profile: 'avatar/athlete/large.png' },
      }),
    );
    const { athlete } = await client.exchangeCode('c');
    expect(athlete).toEqual({
      id: 5,
      firstName: 'Sam',
      sex: null,
      avatarUrl: null,
      isSubscriber: false,
    });
  });

  it('throws a StravaError with the status when Strava rejects the code', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(jsonResponse({ message: 'Bad Request' }, 400));
    const error = await client.exchangeCode('bad').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StravaError);
    expect((error as StravaError).status).toBe(400);
  });

  it('throws a StravaError when the response has no tokens', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(jsonResponse({ athlete: { id: 1 } }));
    await expect(client.exchangeCode('c')).rejects.toThrow(StravaError);
  });

  it('throws a StravaError when the network fails', async () => {
    const { client, fetch } = setup();
    fetch.mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.exchangeCode('c')).rejects.toThrow(StravaError);
  });
});

describe('getValidAccessToken', () => {
  it('returns the stored token without refreshing when it is fresh', async () => {
    const { client, fetch, tokenStore } = setup({
      accessToken: 'fresh',
      refreshToken: 'r',
      expiresAt: new Date(NOW.getTime() + 6 * 60 * 1000),
    });
    await expect(client.getValidAccessToken(1)).resolves.toBe('fresh');
    expect(fetch).not.toHaveBeenCalled();
    expect(tokenStore.save).not.toHaveBeenCalled();
  });

  it('refreshes and saves the token when it expires within 5 minutes', async () => {
    const { client, fetch, tokens } = setup({
      accessToken: 'stale',
      refreshToken: 'refresh-old',
      expiresAt: new Date(NOW.getTime() + 4 * 60 * 1000),
    });
    fetch.mockResolvedValue(
      jsonResponse({
        access_token: 'new-access',
        refresh_token: 'refresh-new',
        expires_at: nowSeconds + 21600,
      }),
    );

    await expect(client.getValidAccessToken(1)).resolves.toBe('new-access');
    expect(sentParams(fetch).params).toEqual({
      client_id: '123',
      client_secret: 'shh',
      grant_type: 'refresh_token',
      refresh_token: 'refresh-old',
    });
    expect(tokens.get(1)).toEqual({
      accessToken: 'new-access',
      refreshToken: 'refresh-new',
      expiresAt: new Date((nowSeconds + 21600) * 1000),
    });
  });

  it('refreshes an already expired token', async () => {
    const { client, fetch } = setup({
      accessToken: 'expired',
      refreshToken: 'r',
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    fetch.mockResolvedValue(
      jsonResponse({ access_token: 'new', refresh_token: 'r2', expires_at: nowSeconds + 60 * 60 }),
    );
    await expect(client.getValidAccessToken(1)).resolves.toBe('new');
  });

  it('keeps the old tokens and throws when the refresh fails', async () => {
    const stored = {
      accessToken: 'stale',
      refreshToken: 'revoked',
      expiresAt: new Date(NOW.getTime() + 60 * 1000),
    };
    const { client, fetch, tokens, tokenStore } = setup(stored);
    fetch.mockResolvedValue(jsonResponse({ message: 'Authorization Error' }, 401));

    const error = await client.getValidAccessToken(1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StravaError);
    expect((error as StravaError).status).toBe(401);
    expect(tokenStore.save).not.toHaveBeenCalled();
    expect(tokens.get(1)).toEqual(stored);
  });

  it('throws when the Runner has no tokens', async () => {
    const { client, fetch } = setup();
    await expect(client.getValidAccessToken(1)).rejects.toThrow(StravaError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('deauthorize', () => {
  it('posts the access token to the deauthorize endpoint', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(jsonResponse({ access_token: 'tok' }));
    await client.deauthorize('tok');
    expect(sentParams(fetch)).toEqual({
      url: STRAVA_DEAUTHORIZE_URL,
      method: 'POST',
      params: { access_token: 'tok' },
    });
  });

  it('throws a StravaError when Strava refuses', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(jsonResponse({ message: 'Authorization Error' }, 401));
    await expect(client.deauthorize('tok')).rejects.toThrow(StravaError);
  });
});
