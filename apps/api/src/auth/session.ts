// The Runner's session: an httpOnly signed cookie holding their Runner id.
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const SESSION_COOKIE = 'mykom_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function cookieOptions(request: FastifyRequest): CookieSerializeOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: request.protocol === 'https',
    signed: true,
  };
}

export function startSession(request: FastifyRequest, reply: FastifyReply, runnerId: number) {
  reply.setCookie(SESSION_COOKIE, String(runnerId), {
    ...cookieOptions(request),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function endSession(request: FastifyRequest, reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, cookieOptions(request));
}

/** The signed-in Runner's id, or undefined when the cookie is missing or tampered with. */
export function sessionRunnerId(request: FastifyRequest): number | undefined {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return undefined;
  const { valid, value } = request.unsignCookie(raw);
  if (!valid || value === null) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}
