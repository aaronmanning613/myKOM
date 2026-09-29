// Verifies the Google-signed OIDC ID tokens Cloud Scheduler sends to `POST /internal/tick`.
import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';

/** Google's public signing keys for ID tokens. */
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** Leeway for clock differences when checking `exp` and `iat`. */
const CLOCK_SKEW_S = 60;
/** Google rotates its keys every few days; cached keys are re-read after this. */
const JWKS_MAX_AGE_MS = 60 * 60 * 1000;
/** An unknown key id re-reads the keys, but no more often than this. */
const JWKS_MIN_REFETCH_MS = 60 * 1000;

export type OidcVerification = { ok: true } | { ok: false; reason: string };
/** Checks a bearer token. Never throws for a bad token; the reason is for the log. */
export type OidcVerifier = (token: string) => Promise<OidcVerification>;

export type GoogleOidcOptions = {
  /** The expected `aud`: the service URL Cloud Scheduler is configured with. */
  audience: string;
  /** The expected `email`: the Scheduler's service account. */
  serviceAccountEmail: string;
  fetch?: typeof globalThis.fetch;
  jwksUrl?: string;
  now?: () => Date;
};

type Jwk = JsonWebKey & { kid?: string };

export function createGoogleOidcVerifier({
  audience,
  serviceAccountEmail,
  fetch = globalThis.fetch,
  jwksUrl = GOOGLE_JWKS_URL,
  now = () => new Date(),
}: GoogleOidcOptions): OidcVerifier {
  let keys = new Map<string, KeyObject>();
  let fetchedAt = -Infinity;

  async function keyFor(kid: string): Promise<KeyObject | undefined> {
    const age = now().getTime() - fetchedAt;
    const stale = age > JWKS_MAX_AGE_MS;
    if (stale || (!keys.has(kid) && age > JWKS_MIN_REFETCH_MS)) {
      const response = await fetch(jwksUrl);
      if (!response.ok) throw new Error(`Google's signing keys: HTTP ${response.status}`);
      const body = (await response.json()) as { keys?: Jwk[] };
      const next = new Map<string, KeyObject>();
      for (const jwk of body.keys ?? []) {
        if (jwk.kid && jwk.kty === 'RSA')
          next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
      }
      keys = next;
      fetchedAt = now().getTime();
    }
    return keys.get(kid);
  }

  return async (token) => {
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'not a JWT' };
    const [encodedHeader, encodedPayload, signature] = parts as [string, string, string];
    const header = decodeJson(encodedHeader);
    const payload = decodeJson(encodedPayload);
    if (!header || !payload) return { ok: false, reason: 'not a JWT' };
    if (header.alg !== 'RS256')
      return { ok: false, reason: `unexpected alg ${String(header.alg)}` };
    if (typeof header.kid !== 'string') return { ok: false, reason: 'no key id' };
    const key = await keyFor(header.kid);
    if (!key) return { ok: false, reason: 'unknown signing key' };
    const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`);
    if (!verify('RSA-SHA256', signed, key, Buffer.from(signature, 'base64url'))) {
      return { ok: false, reason: 'bad signature' };
    }
    const seconds = now().getTime() / 1000;
    if (!GOOGLE_ISSUERS.includes(payload.iss as string)) {
      return { ok: false, reason: 'wrong issuer' };
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(audience)) return { ok: false, reason: 'wrong audience' };
    if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S < seconds) {
      return { ok: false, reason: 'expired' };
    }
    if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_S > seconds) {
      return { ok: false, reason: 'issued in the future' };
    }
    if (payload.email !== serviceAccountEmail || payload.email_verified !== true) {
      return { ok: false, reason: 'wrong service account' };
    }
    return { ok: true };
  };
}

function decodeJson(part: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
