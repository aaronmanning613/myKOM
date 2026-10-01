import {
  FIRST_BURST_PARALLEL,
  RESULTS_DRAIN_SECONDS,
  type DebugSegments,
  type Results,
} from '@mykom/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { requireRunner } from '../auth/guard.js';
import { endSession } from '../auth/session.js';
import type { Database } from '../db/client.js';
import type { JobQueue } from '../jobs/queue.js';
import { loadSearchArea } from '../search-area/store.js';
import type { StravaClient } from '../strava/client.js';
import { loadDebugSegments, loadResults } from './load.js';

export type ResultsRoutesOptions = {
  db: Database['db'];
  strava: StravaClient;
  queue: JobQueue;
  /** Registers `GET /api/debug/segments`. Never on in production. */
  debug?: boolean;
};

const noSearchArea = (reply: FastifyReply) => reply.code(404).send({ error: 'no_search_area' });

/** Deleted mid-request: a job found their Strava access revoked. */
function signedOut(request: FastifyRequest, reply: FastifyReply) {
  endSession(request, reply);
  return reply.code(401).send({ error: 'signed_out' });
}

export const resultsRoutes: FastifyPluginAsync<ResultsRoutesOptions> = async (
  app,
  { db, strava, queue, debug = false },
) => {
  // The Search Area's ranked results. The page polls this while work is pending, and each poll
  // spends a couple of seconds on the Runner's search work first.
  app.get('/api/results', async (request, reply) => {
    const runner = await requireRunner(db, request, reply);
    if (!runner) return reply;
    if (!(await loadSearchArea(db, runner.id))) return noSearchArea(reply);
    const now = () => new Date();
    // With nothing of the Runner's at search priority runnable, this returns straight away.
    await queue.drain({
      deadline: new Date(now().getTime() + RESULTS_DRAIN_SECONDS * 1000),
      now,
      strava,
      concurrency: FIRST_BURST_PARALLEL,
      runnerId: runner.id,
      minPriority: 'search',
    });
    const results: Results | null = await loadResults(db, runner.id, now());
    return results ?? signedOut(request, reply);
  });

  if (!debug) return;

  // Every Known Segment with the list it's in or why it's in none. Not linked from the UI.
  app.get('/api/debug/segments', async (request, reply) => {
    const runner = await requireRunner(db, request, reply);
    if (!runner) return reply;
    const segments: DebugSegments | null = await loadDebugSegments(db, runner.id);
    return segments ?? noSearchArea(reply);
  });
};
