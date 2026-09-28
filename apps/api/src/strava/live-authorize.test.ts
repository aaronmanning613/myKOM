import { describe, expect, it } from 'vitest';
import { LIVE_AUTHORIZE_REDIRECT_URI, parseAuthorizationRedirect } from './live-authorize.js';

const redirect = (params: Record<string, string>) =>
  `${LIVE_AUTHORIZE_REDIRECT_URI}?${new URLSearchParams(params)}`;

describe('parseAuthorizationRedirect', () => {
  it('reads the code and granted scopes from the redirect URL', () => {
    expect(
      parseAuthorizationRedirect(
        `  ${redirect({ state: 's1', code: 'abc123', scope: 'read,activity:read_all' })}\n`,
        's1',
      ),
    ).toEqual({ code: 'abc123', scopes: ['read', 'activity:read_all'] });
  });

  it('accepts just the code, with the scopes unknown', () => {
    expect(parseAuthorizationRedirect('abc123', 's1')).toEqual({ code: 'abc123' });
  });

  it('rejects a mismatched or missing state', () => {
    expect(() =>
      parseAuthorizationRedirect(redirect({ state: 'other', code: 'abc' }), 's1'),
    ).toThrow(/state doesn't match/);
    expect(() => parseAuthorizationRedirect(redirect({ code: 'abc' }), 's1')).toThrow(
      /state doesn't match/,
    );
  });

  it('reports a denial or other error from Strava', () => {
    expect(() =>
      parseAuthorizationRedirect(redirect({ state: 's1', error: 'access_denied' }), 's1'),
    ).toThrow('Access was denied on Strava');
    expect(() =>
      parseAuthorizationRedirect(redirect({ state: 's1', error: 'server_error' }), 's1'),
    ).toThrow('Strava reported an error');
  });

  it('rejects empty input, a URL without a code and junk, without repeating it', () => {
    expect(() => parseAuthorizationRedirect('   ', 's1')).toThrow('Nothing was pasted');
    expect(() => parseAuthorizationRedirect(redirect({ state: 's1' }), 's1')).toThrow(/no code/);
    expect(() => parseAuthorizationRedirect('not a code!', 's1')).toThrow(
      /^That doesn't look like a Strava code or redirect URL$/,
    );
  });
});
