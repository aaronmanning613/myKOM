// Helpers for `pnpm strava:authorize`, which gets a fresh live token when the old one is lost or
// revoked. The Runner approves myKOM on Strava in their own browser; nothing here automates
// Strava's login or consent pages.

/** Strava's documented redirect for apps without a server: the browser lands on a dead page whose URL holds the code. */
export const LIVE_AUTHORIZE_REDIRECT_URI = 'http://localhost/exchange_token';

export type AuthorizationRedirect = {
  code: string;
  /** The scopes granted, when the pasted text was the whole redirect URL. */
  scopes?: string[];
};

/**
 * Reads what the Runner pasted back: the whole redirect URL (preferred, since it also carries
 * the granted scopes) or just the code. Throws when Strava reported an error or the state
 * doesn't match. Error messages never repeat the pasted text.
 */
export function parseAuthorizationRedirect(
  input: string,
  expectedState: string,
): AuthorizationRedirect {
  const text = input.trim();
  if (!text) throw new Error('Nothing was pasted');
  if (!/^https?:\/\//i.test(text)) {
    if (!/^[A-Za-z0-9]+$/.test(text)) {
      throw new Error("That doesn't look like a Strava code or redirect URL");
    }
    return { code: text };
  }
  let params: URLSearchParams;
  try {
    params = new URL(text).searchParams;
  } catch {
    throw new Error("That doesn't look like a Strava code or redirect URL");
  }
  const error = params.get('error');
  if (error) {
    throw new Error(
      error === 'access_denied' ? 'Access was denied on Strava' : 'Strava reported an error',
    );
  }
  if (params.get('state') !== expectedState) {
    throw new Error("The redirect's state doesn't match this run: start again");
  }
  const code = params.get('code');
  if (!code) throw new Error('The redirect URL has no code');
  const scope = params.get('scope');
  return {
    code,
    ...(scope !== null && { scopes: scope.split(',').filter(Boolean) }),
  };
}
