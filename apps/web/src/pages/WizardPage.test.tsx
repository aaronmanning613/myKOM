import type {
  Benchmark,
  BenchmarkDistanceId,
  FitnessProfile,
  GeocodeResult,
  Me,
  Preferences,
  ResultRow,
  Results,
  SearchAreaUpdate,
} from '@mykom/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../routes';
import { json, signedIn, stubApi, testRunner } from '../test/api';
import { RESULTS_POLL_MS } from './ResultsPage';

const newRunner: Me = { ...testRunner, onboarded: false };

function benchmark(distance: BenchmarkDistanceId, seconds: number): Benchmark {
  return {
    distance,
    seconds,
    source: 'generated',
    generatedSeconds: seconds,
    soft: false,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

const generated: FitnessProfile = {
  benchmarks: [benchmark('5k', 883), benchmark('10k', 1836), benchmark('marathon', 8476)],
  generation: {
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
    ],
    generatedAt: '2026-09-01T00:00:00.000Z',
  },
  suggestion: null,
  resyncedAt: null,
};

const oneBenchmark: FitnessProfile = {
  benchmarks: [{ ...benchmark('5k', 960), source: 'runner', generatedSeconds: null }],
  generation: null,
  suggestion: null,
  resyncedAt: null,
};

const place: GeocodeResult = { label: 'High Park, Toronto', lat: 43.6465, lng: -79.4637 };

function row(segmentId: number, name: string): ResultRow {
  return {
    segmentId,
    name,
    distance: 1000,
    averageGrade: 0.01,
    kmFromCentre: 0.5,
    athleteCount: 900,
    record: 185,
    predicted: { seconds: 183, confidence: 'high', reason: 'within-range' },
    pb: 190,
    held: false,
    implausible: false,
    recordCheckedAt: new Date().toISOString(),
    start: { lat: 43.65, lng: -79.4637 },
    polyline: null,
  };
}

function results(overrides: Partial<Results> = {}): Results {
  return {
    searchArea: { ...place, radiusKm: 5 },
    recordGender: 'KOM',
    targets: [],
    nearestMisses: [],
    suspicious: [],
    achievableCount: 0,
    knownCount: 0,
    enoughBenchmarks: true,
    progress: {
      status: 'running',
      runsChecked: 3,
      runsTotal: 12,
      segmentsChecked: 2,
      segmentsTotal: 5,
      segmentsFound: 5,
    },
    pending: true,
    budget: { continuesTomorrow: false, pausedUntil: null },
    ...overrides,
  };
}

function renderAt(path = '/welcome') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const continueButton = () => screen.getByRole('button', { name: 'Looks right, continue' });

afterEach(() => {
  vi.useRealTimers();
});

describe('the first-run wizard', () => {
  it('walks a new Runner through all three steps to their results', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const searches: SearchAreaUpdate[] = [];
    let polls = 0;
    const fetchMock = stubApi({
      ...signedIn(newRunner),
      'GET /api/fitness-profile': () => json(generated),
      'GET /api/geocode?q=High+Park': () => json({ results: [place] }),
      'POST /api/search': (init) => {
        searches.push(JSON.parse(String(init?.body)) as SearchAreaUpdate);
        return json(results({ targets: [row(1, 'Grenadier Pond Loop')] }));
      },
      'GET /api/results': () => {
        polls += 1;
        return json(
          results({
            targets: [row(1, 'Grenadier Pond Loop'), row(2, 'Colborne Lodge Hill')],
            progress: {
              status: 'done',
              runsChecked: 12,
              runsTotal: 12,
              segmentsChecked: 9,
              segmentsTotal: 9,
              segmentsFound: 9,
            },
            pending: false,
          }),
        );
      },
    });
    const router = renderAt();

    // Step 1: the generated profile.
    const steps = await screen.findByRole('list', { name: 'Steps' });
    expect(within(steps).getByText('1. Your fitness')).toHaveAttribute('aria-current', 'step');
    expect(await screen.findByText(/^Estimated from/, { selector: 'p' })).toHaveTextContent(
      'Estimated from Toronto Waterfront Marathon (2:21:03, 19 Oct 2025), your only race-like run.',
    );
    expect(await screen.findByLabelText('5K')).toHaveValue('14:43');
    expect(screen.queryByRole('group', { name: /Which record/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    await userEvent.click(continueButton());

    // Step 2: the Search Area.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Where do you run?' }),
    ).toBeVisible();
    expect(within(steps).getByText('2. Where you run')).toHaveAttribute('aria-current', 'step');
    await userEvent.type(screen.getByLabelText('Place or postcode'), 'High Park{Enter}');
    const found = await screen.findByRole('list', { name: 'Places found' });
    await userEvent.click(within(found).getByRole('button', { name: /^High Park/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Find my targets' }));

    // Step 3: progress and the first targets, then the rest from the poll.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Finding your targets…' }),
    ).toBeVisible();
    expect(searches).toEqual([{ ...place, radiusKm: 5 }]);
    expect(
      screen.getByText(
        '3 of ~12 runs checked · 5 Segments found. You can leave; this keeps going.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Runs checked' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
    expect(screen.getByRole('heading', { name: 'Your targets (1)' })).toBeVisible();
    expect(polls).toBe(0);

    await act(() => vi.advanceTimersByTimeAsync(RESULTS_POLL_MS));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your targets are ready' }),
    ).toBeVisible();
    expect(screen.getByText('12 of ~12 runs checked · 9 Segments found.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your targets (2)' })).toBeVisible();
    expect(screen.getByRole('row', { name: /Colborne Lodge Hill/ })).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'View Colborne Lodge Hill on Strava' }),
    ).toHaveAttribute('href', 'https://www.strava.com/segments/2');

    // Done: no more polling.
    await act(() => vi.advanceTimersByTimeAsync(RESULTS_POLL_MS * 2));
    expect(polls).toBe(1);

    await userEvent.click(screen.getByRole('link', { name: 'See all results' }));
    expect(router.state.location.pathname).toBe('/results');
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/preferences', expect.anything());

    // Now onboarded, so / goes to Results rather than back to the wizard.
    await act(() => router.navigate('/'));
    expect(router.state.location.pathname).toBe('/results');
  });

  it('says it is reading the Runner’s runs while the profile loads', async () => {
    stubApi({ ...signedIn(newRunner), 'GET /api/fitness-profile': () => new Promise(() => {}) });
    renderAt();

    expect(await screen.findByText('Reading your runs from the last 3 years…')).toBeVisible();
  });

  it('keeps continue disabled until there are two Benchmarks', async () => {
    stubApi({ ...signedIn(newRunner), 'GET /api/fitness-profile': () => json(oneBenchmark) });
    renderAt();

    expect(
      await screen.findByText(/didn’t find any race-like runs.*Enter one time you could run today/),
    ).toBeVisible();
    expect(continueButton()).toBeDisabled();
    expect(screen.getByText('Enter at least two times.')).toBeVisible();
  });

  it('asks KOM or QOM when Strava has no sex set, and saves the answer', async () => {
    const saved: Preferences[] = [];
    stubApi({
      ...signedIn({ ...newRunner, sex: null }),
      'GET /api/fitness-profile': () => json(generated),
      'PUT /api/preferences': (init) => {
        const body = JSON.parse(String(init?.body)) as Preferences;
        saved.push(body);
        return json(body);
      },
    });
    renderAt();

    const question = await screen.findByRole('group', { name: 'Which record should you chase?' });
    expect(continueButton()).toBeDisabled();
    expect(screen.getByText('Choose KOM or QOM.')).toBeVisible();

    await userEvent.click(within(question).getByRole('radio', { name: /QOM/ }));
    expect(saved).toEqual([{ recordGender: 'QOM' }]);
    expect(within(question).getByRole('radio', { name: /QOM/ })).toBeChecked();
    expect(continueButton()).toBeEnabled();
  });

  it('shows an error when the KOM/QOM answer can’t be saved', async () => {
    stubApi({
      ...signedIn({ ...newRunner, sex: null }),
      'GET /api/fitness-profile': () => json(generated),
      'PUT /api/preferences': () => json({ error: 'nope' }, 500),
    });
    renderAt();

    const question = await screen.findByRole('group', { name: 'Which record should you chase?' });
    await userEvent.click(within(question).getByRole('radio', { name: /KOM/ }));
    expect(await within(question).findByRole('alert')).toHaveTextContent('Couldn’t save');
    expect(continueButton()).toBeDisabled();
  });

  it('keeps a remembered KOM/QOM answer when the Runner comes back to step 1', async () => {
    stubApi({
      ...signedIn({ ...newRunner, sex: null, recordGender: 'KOM' }),
      'GET /api/fitness-profile': () => json(generated),
    });
    renderAt();

    const question = await screen.findByRole('group', { name: 'Which record should you chase?' });
    expect(within(question).getByRole('radio', { name: /KOM/ })).toBeChecked();
    expect(continueButton()).toBeEnabled();
  });

  it('sends an onboarded Runner to Results', async () => {
    stubApi(signedIn());
    const router = renderAt();

    expect(await screen.findByRole('heading', { level: 1, name: 'Results' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/results');
  });
});
