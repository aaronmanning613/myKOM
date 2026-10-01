// Encrypts Runners' Strava tokens at rest (AES-256-GCM, key from TOKEN_ENCRYPTION_KEY).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Marks an encrypted value: `v1:<iv>:<auth tag>:<ciphertext>`, each part base64url. */
const PREFIX = 'v1:';
const ALGORITHM = 'aes-256-gcm';
export const TOKEN_KEY_BYTES = 32;
const IV_BYTES = 12;

export class TokenDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenDecryptionError';
  }
}

export type TokenCipher = {
  encrypt(plain: string): string;
  /** Throws TokenDecryptionError for a plain-text value or one encrypted with another key. */
  decrypt(stored: string): string;
};

/** True for a value `encrypt` produced (Strava tokens themselves are hex, so never match). */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export function createTokenCipher(key: Buffer): TokenCipher {
  if (key.length !== TOKEN_KEY_BYTES) {
    throw new Error(`The token encryption key must be ${TOKEN_KEY_BYTES} bytes, got ${key.length}`);
  }
  return {
    encrypt(plain) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return (
        PREFIX + [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64url')).join(':')
      );
    },
    decrypt(stored) {
      if (!isEncrypted(stored)) {
        throw new TokenDecryptionError(
          'A stored Strava token is not encrypted: run `pnpm db:migrate` to encrypt existing tokens',
        );
      }
      const [iv, tag, ciphertext] = stored
        .slice(PREFIX.length)
        .split(':')
        .map((part) => Buffer.from(part, 'base64url'));
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv!);
        decipher.setAuthTag(tag!);
        return Buffer.concat([decipher.update(ciphertext!), decipher.final()]).toString('utf8');
      } catch {
        throw new TokenDecryptionError(
          'Could not decrypt a stored Strava token: TOKEN_ENCRYPTION_KEY is not the key it was encrypted with',
        );
      }
    },
  };
}
