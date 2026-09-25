import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/client.js';
import type { Runner } from '../db/schema.js';
import { findRunner } from './runners.js';
import { endSession, sessionRunnerId } from './session.js';

/**
 * The signed-in Runner. When there isn't one, replies 401 and returns undefined, so the
 * route should return straight away: `if (!runner) return reply;`.
 */
export async function requireRunner(
  db: Database['db'],
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Runner | undefined> {
  const runnerId = sessionRunnerId(request);
  const runner = runnerId === undefined ? undefined : await findRunner(db, runnerId);
  if (!runner) {
    // Covers a Runner deleted since the cookie was issued.
    if (runnerId !== undefined) endSession(request, reply);
    reply.code(401).send({ error: 'signed_out' });
  }
  return runner;
}
