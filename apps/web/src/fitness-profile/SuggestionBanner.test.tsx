import type {
  Benchmark,
  BenchmarkDistanceId,
  FitnessProfile,
  ProfileGeneration,
  SuggestionSummary,
} from '@mykom/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../routes';
import { json, signedIn, stubApi, testRunner } from '../test/api';
import { suggestionText } from './SuggestionBanner';

const spring10k = {
  activityId: 21,
  name: 'Harry’s Spring Run Off',
  startDate: '2026-09-27T12:00:00Z',
  benchmark: '10k' as const,
  distance: 10_020,
  movingTime: 1800,
};

const summary: SuggestionSummary = { vdot: 71.3, appliedVdot: 70.1, source: spring10k };

const generation: ProfileGeneration = {
  vdot: 70.1,
  sources: [],
  generatedAt: '2026-09-01T00:00:00.000Z',
};

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

/** The 5K pinned, the 10K and marathon generated, with a suggestion pending. */
const withSuggestion: FitnessProfile = {
  benchmarks: [
    benchmark('5k', 870, { source: 'runner', generatedSeconds: 895 }),
    benchmark('10k', 1860),
    benchmark('marathon', 8600),
  ],
  generation,
  suggestion: {
    vdot: 71.3,
    sources: [spring10k],
    generatedAt: '2026-09-28T00:00:00.000Z',
    benchmarks: [
      { distance: '5k', seconds: 880 },
      { distance: '10k', seconds: 1830 },
      { distance: 'marathon', seconds: 8600 },
    ],
  },
  resyncedAt: null,
};

/** After Apply: unpinned values moved, the 5K pin kept. */
const applied: FitnessProfile = {
  ...withSuggestion,
  benchmarks: [
    benchmark('5k', 870, { source: 'runner', generatedSeconds: 880 }),
    benchmark('10k', 1830),
    benchmark('marathon', 8600),
  ],
  generation: { ...generation, vdot: 71.3, sources: [spring10k] },
  suggestion: null,
};

const dismissed: FitnessProfile = { ...withSuggestion, suggestion: null };

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const banner = () => screen.findByRole('region', { name: 'Fitness Profile suggestion' });
const suggesting = () => signedIn({ ...testRunner, suggestion: summary });

describe('suggestionText', () => {
  it('names the run, its day and both VDOTs', () => {
    expect(suggestionText(summary)).toBe('Your 10K on 27 Sep suggests VDOT 70.1 → 71.3');
  });

  it('copes without an applied generation or a source run', () => {
    expect(suggestionText({ vdot: 64, appliedVdot: null, source: null })).toBe(
      'Your runs suggest VDOT 64.0',
    );
  });
});

describe('the suggestion banner', () => {
  it('is not shown without a pending suggestion', async () => {
    stubApi(signedIn());
    renderAt('/search-area');

    expect(await screen.findByRole('heading', { level: 1, name: 'Search Area' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Fitness Profile suggestion' })).toBeNull();
  });

  it.each(['/', '/search-area', '/results', '/fitness-profile'])(
    'shows under the nav on %s',
    async (path) => {
      stubApi({ ...suggesting(), 'GET /api/fitness-profile': () => json(withSuggestion) });
      renderAt(path);

      const bar = await banner();
      expect(bar).toHaveTextContent('Your 10K on 27 Sep suggests VDOT 70.1 → 71.3');
      expect(within(bar).getByRole('button', { name: 'Apply' })).toBeVisible();
      expect(within(bar).getByRole('button', { name: 'Dismiss suggestion' })).toBeVisible();
      expect(screen.getByRole('banner')).toContainElement(bar);
    },
  );

  it('applies in place and confirms until the Runner moves on', async () => {
    const bodies: unknown[] = [];
    const router = renderAtWith('/search-area', bodies, () => json(applied));

    await userEvent.click(within(await banner()).getByRole('button', { name: 'Apply' }));

    expect(
      await screen.findByText('Applied: your Fitness Profile is now VDOT 71.3.'),
    ).toHaveAttribute('role', 'status');
    expect(bodies).toEqual([{ action: 'apply' }]);
    expect(router.state.location.pathname).toBe('/search-area');
    expect(screen.queryByRole('region', { name: 'Fitness Profile suggestion' })).toBeNull();

    await userEvent.click(screen.getByRole('link', { name: 'Results' }));
    expect(screen.queryByText(/Applied:/)).toBeNull();
  });

  it('dismisses with ×', async () => {
    const bodies: unknown[] = [];
    renderAtWith('/results', bodies, () => json(dismissed));

    await userEvent.click(
      within(await banner()).getByRole('button', { name: 'Dismiss suggestion' }),
    );

    expect(bodies).toEqual([{ action: 'dismiss' }]);
    expect(screen.queryByRole('region', { name: 'Fitness Profile suggestion' })).toBeNull();
  });

  it('keeps the suggestion and says so when Apply fails', async () => {
    renderAtWith('/results', [], () => json({ error: 'boom' }, 500));

    await userEvent.click(within(await banner()).getByRole('button', { name: 'Apply' }));

    expect(await within(await banner()).findByRole('alert')).toHaveTextContent(
      'Couldn’t apply the suggestion',
    );
  });

  it('Review opens the Fitness Profile with the suggested values beside the Runner’s', async () => {
    stubApi({ ...suggesting(), 'GET /api/fitness-profile': () => json(withSuggestion) });
    const router = renderAt('/results');

    await userEvent.click(within(await banner()).getByRole('link', { name: 'Review' }));

    expect(router.state.location.pathname).toBe('/fitness-profile');
    expect(await screen.findByRole('columnheader', { name: 'Suggested' })).toBeVisible();
    const cells = (label: string) =>
      within(screen.getByLabelText(label, { exact: true }).closest('tr')!).getAllByRole('cell');
    expect(cells('10K')[1]).toHaveTextContent('30:30');
    expect(cells('5K')[1]).toHaveTextContent('stays yours');
    expect(cells('Marathon')[1]).toHaveTextContent('2:23:20');
    expect(cells('8K')[1]).toHaveTextContent('—');
    // Already on the page, so there's nothing to review.
    expect(within(await banner()).queryByRole('link', { name: 'Review' })).toBeNull();
  });

  it('applied on the Fitness Profile page, updates the table there', async () => {
    let profile = withSuggestion;
    stubApi({
      ...suggesting(),
      'GET /api/fitness-profile': () => json(profile),
      'POST /api/fitness-profile/suggestion': () => {
        profile = applied;
        return json(applied);
      },
    });
    renderAt('/fitness-profile');
    expect(await screen.findByLabelText('10K', { exact: true })).toHaveValue('31:00');

    await userEvent.click(within(await banner()).getByRole('button', { name: 'Apply' }));

    expect(await screen.findByDisplayValue('30:30')).toBe(
      screen.getByLabelText('10K', { exact: true }),
    );
    expect(screen.getByLabelText('5K', { exact: true })).toHaveValue('14:30');
    expect(screen.queryByRole('columnheader', { name: 'Suggested' })).toBeNull();
  });

  it('goes away when regenerating on the Fitness Profile page clears the suggestion', async () => {
    stubApi({
      ...suggesting(),
      'GET /api/fitness-profile': () => json(withSuggestion),
      'POST /api/fitness-profile/regenerate': () => json(applied),
    });
    renderAt('/fitness-profile');
    await banner();

    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate from Strava' }));

    expect(await screen.findByDisplayValue('30:30')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Fitness Profile suggestion' })).toBeNull();
  });

  it('appears when the Fitness Profile page finds a suggestion /api/me didn’t report', async () => {
    stubApi({ ...signedIn(), 'GET /api/fitness-profile': () => json(withSuggestion) });
    renderAt('/fitness-profile');

    expect(await banner()).toHaveTextContent('suggests VDOT 70.1 → 71.3');
  });
});

/** Renders with a suggestion pending, recording each suggestion request's body. */
function renderAtWith(path: string, bodies: unknown[], reply: () => Response) {
  stubApi({
    ...suggesting(),
    'POST /api/fitness-profile/suggestion': (init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return reply();
    },
  });
  return renderAt(path);
}
