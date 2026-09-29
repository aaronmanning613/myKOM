import type {
  Benchmark,
  BenchmarkDistanceId,
  FitnessProfile,
  FitnessProfileUpdate,
  ProfileGeneration,
} from '@mykom/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../routes';
import { json, signedIn, stubApi } from '../test/api';

function benchmark(
  distance: BenchmarkDistanceId,
  seconds: number,
  extra: Partial<Benchmark> = {},
): Benchmark {
  return {
    distance,
    seconds,
    source: 'generated',
    generatedSeconds: seconds,
    soft: false,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...extra,
  };
}

const generation: ProfileGeneration = {
  vdot: 71.1,
  sources: [
    {
      activityId: 11,
      name: 'Toronto Waterfront Marathon',
      startDate: '2025-10-19T12:00:00Z',
      benchmark: 'marathon',
      distance: 42_300,
      movingTime: 8463,
    },
    {
      activityId: 12,
      name: 'Harry’s Spring Run Off',
      startDate: '2026-04-11T12:00:00Z',
      benchmark: '10k',
      distance: 10_020,
      movingTime: 1839,
    },
  ],
  generatedAt: '2026-09-01T00:00:00.000Z',
};

/** A generated profile with the 5K pinned (by the Runner) and the 1K soft. */
const generated: FitnessProfile = {
  benchmarks: [
    benchmark('1k', 240, { soft: true }),
    benchmark('5k', 870, { source: 'runner', generatedSeconds: 883 }),
    benchmark('10k', 1836),
    benchmark('marathon', 8476),
  ],
  generation,
  suggestion: null,
  resyncedAt: null,
};

const empty: FitnessProfile = {
  benchmarks: [],
  generation: null,
  suggestion: null,
  resyncedAt: null,
};

/** Records each request body sent to a route and answers with `reply`. */
function recording<T>(bodies: T[], reply: FitnessProfile | ((body: T) => FitnessProfile)) {
  return (init?: RequestInit) => {
    const body = (init?.body ? JSON.parse(String(init.body)) : undefined) as T;
    bodies.push(body);
    return json(typeof reply === 'function' ? reply(body) : reply);
  };
}

/** Echoes a PUT back: new or changed times come back pinned. */
function echoPut(bodies: FitnessProfileUpdate[], before: FitnessProfile = empty) {
  return recording<FitnessProfileUpdate>(bodies, (body) => ({
    ...before,
    benchmarks: body.benchmarks.map((row) => {
      const old = before.benchmarks.find((b) => b.distance === row.distance);
      if (!('seconds' in row)) return benchmark(row.distance, old?.generatedSeconds ?? 0);
      if (old && old.seconds === row.seconds) return old;
      return benchmark(row.distance, row.seconds, {
        source: 'runner',
        generatedSeconds: old?.generatedSeconds ?? null,
      });
    }),
  }));
}

function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/fitness-profile'] });
  render(<RouterProvider router={router} />);
}

const timeInput = (label: string) => screen.findByLabelText(label);
const row = async (label: string) => (await timeInput(label)).closest('tr')!;

describe('Fitness Profile', () => {
  it('shows the 13 Benchmarks with pace, pinned and soft rows, and where they came from', async () => {
    stubApi({ ...signedIn(), 'GET /api/fitness-profile': () => json(generated) });
    renderPage();

    const labels = ['400m', '800m', '1K', '1 mile', '3K', '5K', '8K', '10K', '15K', '10 mile'];
    for (const label of [...labels, 'Half marathon', '30K', 'Marathon']) {
      expect(await timeInput(label)).toBeVisible();
    }
    expect(screen.getAllByRole('textbox')).toHaveLength(13);
    expect(await timeInput('5K')).toHaveValue('14:30');
    expect(await timeInput('5K')).toHaveAccessibleDescription('2:54/km');
    expect(await timeInput('8K')).toHaveValue('');

    expect(await row('5K')).toHaveTextContent('📌 yours · generated 14:43 · use generated');
    expect(await row('10K')).not.toHaveTextContent('📌');
    expect(await row('1K')).toHaveTextContent('⚠ soft');
    expect(await row('5K')).not.toHaveTextContent('soft');

    expect(
      screen.getByText(/^Estimated from/, { selector: 'p' }).textContent?.replace(/\s+/g, ' '),
    ).toBe(
      'Estimated from Toronto Waterfront Marathon (2:21:03, 19 Oct 2025) and Harry’s Spring Run Off (30:39, 11 Apr 2026). Change anything that looks off.',
    );
    expect(screen.getByRole('button', { name: 'Reset all to generated' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Update all from this' })).not.toBeInTheDocument();
    expect(screen.getByText(/Last resynced: never/)).toBeVisible();
  });

  it('says when a single run set the profile', async () => {
    const one = { ...generated, generation: { ...generation, sources: [generation.sources[0]!] } };
    stubApi({ ...signedIn(), 'GET /api/fitness-profile': () => json(one) });
    renderPage();

    expect(await screen.findByText(/, your only race-like run\./)).toBeVisible();
  });

  it('explains an empty profile', async () => {
    stubApi(signedIn());
    renderPage();

    expect(
      await screen.findByText(
        /didn’t find any race-like runs in your last 3 years.*Enter at least two times/,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Reset all to generated' }),
    ).not.toBeInTheDocument();
  });

  it('saves a row when it is left, pinning it and offering Update all from this', async () => {
    const bodies: FitnessProfileUpdate[] = [];
    stubApi({
      ...signedIn(),
      'GET /api/fitness-profile': () => json(generated),
      'PUT /api/fitness-profile': echoPut(bodies, generated),
    });
    renderPage();

    const tenK = await timeInput('10K');
    await userEvent.clear(tenK);
    await userEvent.type(tenK, '30:00');
    await userEvent.tab();

    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(bodies).toEqual([
      {
        benchmarks: [
          { distance: '1k', seconds: 240 },
          { distance: '5k', seconds: 870 },
          { distance: 'marathon', seconds: 8476 },
          { distance: '10k', seconds: 1800 },
        ],
      },
    ]);
    expect(await row('10K')).toHaveTextContent('📌 yours · generated 30:36 · use generated');
    expect(
      within(await row('10K')).getByRole('button', { name: 'Update all from this' }),
    ).toBeVisible();
    // Only on the row just edited.
    expect(screen.getAllByRole('button', { name: 'Update all from this' })).toHaveLength(1);
  });

  it('saves on Enter, adds new rows and clears emptied ones', async () => {
    const bodies: FitnessProfileUpdate[] = [];
    stubApi({
      ...signedIn(),
      'GET /api/fitness-profile': () => json(generated),
      'PUT /api/fitness-profile': echoPut(bodies, generated),
    });
    renderPage();

    await userEvent.type(await timeInput('400m'), '62{Enter}');
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(await timeInput('400m')).toHaveValue('1:02');

    await userEvent.clear(await timeInput('Marathon'));
    await userEvent.tab();

    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(bodies.map((b) => b.benchmarks.map((r) => r.distance))).toEqual([
      ['1k', '5k', '10k', 'marathon', '400m'],
      ['1k', '5k', '10k', '400m'],
    ]);
    expect(await timeInput('Marathon')).toHaveValue('');
    // Clearing a row doesn't offer to update the rest from it.
    expect(screen.queryByRole('button', { name: 'Update all from this' })).not.toBeInTheDocument();
  });

  it('doesn’t save a row that was left unchanged', async () => {
    const bodies: FitnessProfileUpdate[] = [];
    stubApi({
      ...signedIn(),
      'GET /api/fitness-profile': () => json(generated),
      'PUT /api/fitness-profile': echoPut(bodies, generated),
    });
    renderPage();

    const fiveK = await timeInput('5K');
    await userEvent.clear(fiveK);
    await userEvent.type(fiveK, '14:30');
    await userEvent.tab();

    expect(bodies).toEqual([]);
  });

  it('shows inline errors for invalid times and doesn’t save them', async () => {
    const bodies: FitnessProfileUpdate[] = [];
    stubApi({ ...signedIn(), 'PUT /api/fitness-profile': echoPut(bodies) });
    renderPage();

    const mile = await timeInput('1 mile');
    await userEvent.type(mile, '5:75');
    expect(mile).not.toHaveAttribute('aria-invalid');
    await userEvent.tab();

    expect(mile).toHaveAttribute('aria-invalid', 'true');
    expect(mile).toHaveAccessibleDescription('Minutes and seconds must be under 60');

    await userEvent.type(await timeInput('Marathon'), '25:00:00{Enter}');
    expect(await timeInput('Marathon')).toHaveAccessibleDescription('Time must be under 24 hours');
    expect(bodies).toEqual([]);

    await userEvent.clear(mile);
    await userEvent.type(mile, '6:10');
    expect(mile).not.toHaveAttribute('aria-invalid');
    expect(mile).toHaveAccessibleDescription('3:50/km');
  });

  it('updates all Benchmarks from the row just edited', async () => {
    const puts: FitnessProfileUpdate[] = [];
    const posts: unknown[] = [];
    const updated: FitnessProfile = {
      ...generated,
      benchmarks: [
        benchmark('5k', 960, { source: 'runner', generatedSeconds: 883 }),
        benchmark('10k', 1993, { source: 'runner', generatedSeconds: 1836 }),
      ],
    };
    stubApi({
      ...signedIn(),
      'GET /api/fitness-profile': () => json(generated),
      'PUT /api/fitness-profile': echoPut(puts, generated),
      'POST /api/fitness-profile/update-all': recording(posts, updated),
    });
    renderPage();

    const fiveK = await timeInput('5K');
    await userEvent.clear(fiveK);
    await userEvent.type(fiveK, '16:00');
    await userEvent.tab();
    await userEvent.click(await screen.findByRole('button', { name: 'Update all from this' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'All Benchmarks updated from your 5K of 16:00.',
    );
    expect(posts).toEqual([{ distance: '5k', seconds: 960 }]);
    expect(await timeInput('10K')).toHaveValue('33:13');
    expect(screen.queryByRole('button', { name: 'Update all from this' })).not.toBeInTheDocument();
  });

  it('puts a pinned row back to its generated time', async () => {
    const bodies: FitnessProfileUpdate[] = [];
    stubApi({
      ...signedIn(),
      'GET /api/fitness-profile': () => json(generated),
      'PUT /api/fitness-profile': echoPut(bodies, generated),
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Use generated 5K' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      '5K is back to the generated time.',
    );
    expect(bodies).toEqual([
      {
        benchmarks: [
          { distance: '1k', seconds: 240 },
          { distance: '10k', seconds: 1836 },
          { distance: 'marathon', seconds: 8476 },
          { distance: '5k', useGenerated: true },
        ],
      },
    ]);
    expect(await timeInput('5K')).toHaveValue('14:43');
    expect(await row('5K')).not.toHaveTextContent('📌');
    expect(
      screen.queryByRole('button', { name: 'Reset all to generated' }),
    ).not.toBeInTheDocument();
  });

  it('resets everything to generated', async () => {
    const posts: unknown[] = [];
    const reset: FitnessProfile = {
      ...generated,
      benchmarks: generated.benchmarks.map((b) =>
        benchmark(b.distance, b.generatedSeconds!, { soft: b.soft }),
      ),
    };
    stubApi({
      ...signedIn(),
      'GET /api/fitness-profile': () => json(generated),
      'POST /api/fitness-profile/reset': recording(posts, reset),
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Reset all to generated' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'All Benchmarks reset to generated.',
    );
    expect(posts).toHaveLength(1);
    expect(await timeInput('5K')).toHaveValue('14:43');
    expect(screen.queryByText(/📌 yours/)).not.toBeInTheDocument();
  });

  it('doesn’t offer Reset all to generated without a generated profile', async () => {
    const pinnedOnly: FitnessProfile = {
      ...empty,
      benchmarks: [benchmark('5k', 900, { source: 'runner', generatedSeconds: null })],
    };
    stubApi({ ...signedIn(), 'GET /api/fitness-profile': () => json(pinnedOnly) });
    renderPage();

    expect(await row('5K')).toHaveTextContent('📌 yours');
    expect(await row('5K')).not.toHaveTextContent('use generated');
    expect(
      screen.queryByRole('button', { name: 'Reset all to generated' }),
    ).not.toBeInTheDocument();
  });

  it('regenerates from Strava', async () => {
    const posts: unknown[] = [];
    stubApi({
      ...signedIn(),
      'POST /api/fitness-profile/regenerate': recording(posts, generated),
    });
    renderPage();
    expect(await screen.findByText(/didn’t find any race-like runs/)).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate from Strava' }));

    expect(await screen.findByText(/Estimated from/)).toBeVisible();
    expect(await timeInput('10K')).toHaveValue('30:36');
    expect(posts).toHaveLength(1);
  });

  it('reports a failed regenerate', async () => {
    stubApi({
      ...signedIn(),
      'POST /api/fitness-profile/regenerate': () => json({ error: 'strava' }, 502),
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate from Strava' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t regenerate from Strava');
  });

  it('resyncs the Runner’s runs and shows when it last ran', async () => {
    const posts: unknown[] = [];
    stubApi({
      ...signedIn(),
      'GET /api/fitness-profile': () => json(generated),
      'POST /api/activities/resync': recording(posts, {
        ...generated,
        resyncedAt: '2026-09-29T12:00:00.000Z',
      }),
    });
    renderPage();

    expect(
      await screen.findByText(/Deleted or edited a run on Strava\? Resync to pick it up\./),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Resync my runs' }));

    expect(await screen.findByText(/Last resynced: 29 Sept? 2026/)).toBeVisible();
    expect(posts).toHaveLength(1);
  });

  it('reports a failed save and keeps the entered time', async () => {
    stubApi({ ...signedIn(), 'PUT /api/fitness-profile': () => json({}, 500) });
    renderPage();

    await userEvent.type(await timeInput('5K'), '19:59');
    await userEvent.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save');
    expect(await timeInput('5K')).toHaveValue('19:59');
  });

  it('reports a failed load', async () => {
    stubApi({ ...signedIn(), 'GET /api/fitness-profile': () => json({}, 500) });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t load your Fitness Profile',
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
