import type { ResultRow, Results, SearchAreaUpdate } from '@mykom/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordAge } from '../results/ResultsSection';
import { routes } from '../routes';
import { json, signedIn, stubApi } from '../test/api';
import { RESULTS_POLL_MS } from './ResultsPage';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

function row(overrides: Partial<ResultRow> & Pick<ResultRow, 'segmentId' | 'name'>): ResultRow {
  return {
    distance: 1000,
    averageGrade: 0.012,
    kmFromCentre: 0.6,
    athleteCount: 1200,
    record: 185,
    predicted: { seconds: 183.4, confidence: 'high', reason: 'within-range' },
    pb: 190,
    held: false,
    implausible: false,
    recordCheckedAt: daysAgo(2),
    start: { lat: 45.425, lng: -75.69 },
    polyline: null,
    ...overrides,
  };
}

function results(overrides: Partial<Results> = {}): Results {
  return {
    searchArea: { label: 'Ottawa, Ontario', lat: 45.42, lng: -75.69, radiusKm: 2 },
    recordGender: 'KOM',
    targets: [],
    nearestMisses: [],
    suspicious: [],
    achievableCount: 0,
    knownCount: 0,
    enoughBenchmarks: true,
    progress: {
      status: 'done',
      runsChecked: 12,
      runsTotal: 12,
      segmentsChecked: 30,
      segmentsTotal: 30,
      segmentsFound: 4,
    },
    pending: false,
    budget: { continuesTomorrow: false, pausedUntil: null },
    ...overrides,
  };
}

// A fast Runner: targets (one Held outside the margin and Implausible, one low confidence, one
// never run), no Nearest misses, one Suspicious record.
const fast = results({
  targets: [
    row({
      segmentId: 1,
      name: 'Canal Dash',
      athleteCount: 22051,
      held: true,
      implausible: true,
      pb: 181,
      record: 181,
      predicted: { seconds: 181, confidence: 'high', reason: 'pb-floor' },
      recordCheckedAt: daysAgo(36),
    }),
    row({ segmentId: 2, name: 'Bridge Sprint', pb: null, averageGrade: -0.004, distance: 410 }),
    row({
      segmentId: 3,
      name: 'Parliament Hill',
      distance: 450,
      averageGrade: 0.078,
      athleteCount: 3120,
      record: 98,
      predicted: { seconds: 97.6, confidence: 'low', reason: 'steep' },
      recordCheckedAt: daysAgo(400),
    }),
  ],
  suspicious: [
    row({
      segmentId: 4,
      name: 'Glitchy Straight',
      record: 49,
      implausible: true,
      predicted: { seconds: 71, confidence: 'high', reason: 'within-range' },
    }),
  ],
  achievableCount: 2,
  knownCount: 9,
});

// A slow Runner: nothing Achievable, so Nearest misses by record ratio.
const slow = results({
  nearestMisses: [
    row({ segmentId: 11, name: 'Closest Miss', record: 200, predicted: null }),
    row({
      segmentId: 12,
      name: 'Further Miss',
      record: 240,
      predicted: { seconds: 302, confidence: 'low', reason: 'outside-benchmark-range' },
    }),
  ],
  achievableCount: 0,
  knownCount: 6,
});

function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/results'] });
  render(<RouterProvider router={router} />);
  return router;
}

const section = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name}`) });
const rowFor = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

afterEach(() => {
  vi.useRealTimers();
});

describe('Results', () => {
  it('shows the toolbar, the summary line and the three lists with counts', async () => {
    stubApi({ ...signedIn(), 'GET /api/results': () => json(fast) });
    renderPage();

    expect(await screen.findByText('2 of 9 Known Segments are Achievable.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Results' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Radius' })).toHaveValue('2');
    expect(screen.getByRole('link', { name: 'Ottawa, Ontario' })).toHaveAttribute(
      'href',
      '/search-area',
    );
    expect(screen.getByRole('heading', { name: 'Your targets (3)' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Suspicious records (1)' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: /Nearest misses/ })).not.toBeInTheDocument();
    expect(section('Suspicious records')).toHaveClass('opacity-70');
    expect(section('Your targets')).not.toHaveClass('opacity-70');
    expect(
      within(section('Your targets'))
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0]!.textContent),
    ).toEqual([
      expect.stringContaining('Canal Dash'),
      expect.stringContaining('Bridge Sprint'),
      expect.stringContaining('Parliament Hill'),
    ]);
    expect(screen.queryByText(/refining/)).not.toBeInTheDocument();
    expect(screen.queryByText(/two Benchmarks/)).not.toBeInTheDocument();
  });

  it('shows each row’s name, crown, flag, details, columns and record age', async () => {
    stubApi({ ...signedIn(), 'GET /api/results': () => json(fast) });
    renderPage();

    const held = await screen.findByRole('row', { name: /Canal Dash/ });
    expect(within(held).getByRole('img', { name: 'Held' })).toHaveTextContent('👑');
    expect(held).toHaveTextContent('⚠ Suspicious');
    expect(held).toHaveTextContent('1.00 km · 1.2% · 0.6 km away');
    expect(held).toHaveTextContent('record checked 5 weeks ago');
    expect(
      within(held)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual([expect.any(String), '22,051', '3:01', '3:01', '3:01']);

    const neverRun = rowFor('Bridge Sprint');
    expect(neverRun).toHaveTextContent('410 m · -0.4% · 0.6 km away');
    expect(
      within(neverRun)
        .getAllByRole('cell')
        .slice(3)
        .map((c) => c.textContent),
    ).toEqual(['3:03', '—']);
    expect(within(neverRun).queryByRole('img', { name: 'Held' })).not.toBeInTheDocument();
    expect(neverRun).not.toHaveTextContent('Suspicious');
    expect(neverRun).not.toHaveTextContent('record checked');

    const steep = rowFor('Parliament Hill');
    expect(steep).toHaveTextContent('record checked 1 year ago');
    expect(within(steep).getByTitle('Rough guess: steeper than 15% in places')).toHaveTextContent(
      '~1:38',
    );
    // High-confidence times have no `~` and no reason.
    expect(within(held).getAllByRole('cell')[3]!.textContent).not.toContain('~');
    expect(rowFor('Glitchy Straight')).toHaveTextContent('⚠ Suspicious');
  });

  it('shows Nearest misses for a slow Runner, with no prediction as "—"', async () => {
    stubApi({ ...signedIn(), 'GET /api/results': () => json(slow) });
    renderPage();

    expect(await screen.findByText('0 of 6 Known Segments are Achievable.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your targets (0)' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Nearest misses (2)' })).toBeVisible();
    expect(within(section('Nearest misses')).getAllByRole('row')).toHaveLength(3);
    expect(within(rowFor('Closest Miss')).getAllByRole('cell')[3]).toHaveTextContent('—');
    expect(
      within(rowFor('Further Miss')).getByTitle(
        'Rough guess: outside the range of your Benchmarks',
      ),
    ).toHaveTextContent('~5:02');
    // The empty targets suggest a bigger radius.
    expect(screen.getByText(/No targets within 2 km yet/)).toBeVisible();
  });

  it('suggests a bigger radius when empty, and searching it replaces the list', async () => {
    const bodies: SearchAreaUpdate[] = [];
    stubApi({
      ...signedIn(),
      'GET /api/results': () => json(results()),
      'POST /api/search': (init) => {
        const body = JSON.parse(String(init?.body)) as SearchAreaUpdate;
        bodies.push(body);
        return json({ ...fast, searchArea: body });
      },
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'search 5 km' }));
    expect(await screen.findByRole('heading', { name: 'Your targets (3)' })).toBeVisible();
    expect(bodies).toEqual([{ label: 'Ottawa, Ontario', lat: 45.42, lng: -75.69, radiusKm: 5 }]);
    expect(screen.getByRole('combobox', { name: 'Radius' })).toHaveValue('5');
  });

  it('at the biggest radius, suggests another place instead', async () => {
    stubApi({
      ...signedIn(),
      'GET /api/results': () =>
        json(results({ searchArea: { label: 'Nowhere', lat: 0, lng: 0, radiusKm: 10 } })),
    });
    renderPage();

    expect(await screen.findByText(/No targets within 10 km\./)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Try another place' })).toHaveAttribute(
      'href',
      '/search-area',
    );
  });

  it('re-runs the search from the radius dropdown', async () => {
    const bodies: SearchAreaUpdate[] = [];
    let answer: (response: Response) => void = () => {};
    stubApi({
      ...signedIn(),
      'GET /api/results': () => json(fast),
      'POST /api/search': (init) => {
        bodies.push(JSON.parse(String(init?.body)) as SearchAreaUpdate);
        return new Promise<Response>((resolve) => (answer = resolve));
      },
    });
    renderPage();

    const radius = await screen.findByRole('combobox', { name: 'Radius' });
    expect(
      within(radius)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['1 km', '2 km', '5 km', '10 km']);
    await userEvent.selectOptions(radius, '10');
    expect(await screen.findByText('Searching your Known Segments…')).toBeVisible();
    expect(radius).toBeDisabled();
    expect(bodies).toEqual([{ label: 'Ottawa, Ontario', lat: 45.42, lng: -75.69, radiusKm: 10 }]);

    await act(async () =>
      answer(json({ ...slow, searchArea: { ...fast.searchArea, radiusKm: 10 } })),
    );
    expect(await screen.findByRole('heading', { name: 'Nearest misses (2)' })).toBeVisible();
    expect(radius).toHaveValue('10');
    expect(radius).toBeEnabled();
  });

  it('keeps the list when changing the radius fails', async () => {
    stubApi({
      ...signedIn(),
      'GET /api/results': () => json(fast),
      'POST /api/search': () => json({ error: 'boom' }, 500),
    });
    renderPage();

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Radius' }), '5');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change the radius.');
    expect(screen.getByRole('heading', { name: 'Your targets (3)' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Radius' })).toHaveValue('2');
  });

  it('polls every 5 s while refining, and stops when done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const refining = results({
      ...slow,
      pending: true,
      progress: { ...slow.progress!, status: 'running', segmentsChecked: 3, segmentsTotal: 20 },
    });
    const responses = [
      refining,
      { ...refining, progress: { ...refining.progress!, segmentsChecked: 11 } },
      { ...fast, pending: false },
    ];
    const fetchMock = stubApi({
      ...signedIn(),
      'GET /api/results': () => json(responses.shift() ?? fast),
    });
    const resultsCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url) === '/api/results').length;
    renderPage();

    expect(await screen.findByText('refining: 3 of ~20 Segments checked…')).toBeVisible();
    expect(screen.getByText('None yet: your Segments are still being checked.')).toBeVisible();
    expect(resultsCalls()).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(RESULTS_POLL_MS - 100));
    expect(resultsCalls()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(await screen.findByText('refining: 11 of ~20 Segments checked…')).toBeVisible();
    expect(resultsCalls()).toBe(2);

    await act(() => vi.advanceTimersByTimeAsync(RESULTS_POLL_MS));
    expect(await screen.findByRole('heading', { name: 'Your targets (3)' })).toBeVisible();
    expect(screen.queryByText(/refining/)).not.toBeInTheDocument();
    expect(resultsCalls()).toBe(3);

    await act(() => vi.advanceTimersByTimeAsync(RESULTS_POLL_MS * 3));
    expect(resultsCalls()).toBe(3);
  });

  it('says the rest continues tomorrow at the cap, and stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubApi({
      ...signedIn(),
      'GET /api/results': () =>
        json({
          ...fast,
          pending: true,
          budget: { continuesTomorrow: true, pausedUntil: '2026-09-30T00:00:00.000Z' },
        }),
    });
    renderPage();

    expect(await screen.findByText(/checking the rest continues tomorrow/)).toBeVisible();
    expect(screen.queryByText(/refining/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your targets (3)' })).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(RESULTS_POLL_MS * 2));
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/results')).toHaveLength(1);
  });

  it('prompts for Benchmarks with fewer than two', async () => {
    stubApi({
      ...signedIn(),
      'GET /api/results': () => json({ ...slow, enoughBenchmarks: false, nearestMisses: [] }),
    });
    renderPage();

    expect(await screen.findByText(/Predicted Times need at least two Benchmarks/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Add them on your Fitness Profile' })).toHaveAttribute(
      'href',
      '/fitness-profile',
    );
  });

  it('links to the Search Area page without a Search Area', async () => {
    stubApi({
      ...signedIn(),
      'GET /api/results': () => json({ error: 'no_search_area' }, 404),
    });
    renderPage();

    expect(await screen.findByText(/You haven’t set a Search Area yet/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Choose where to look' })).toHaveAttribute(
      'href',
      '/search-area',
    );
  });

  it('says so when the results fail to load', async () => {
    stubApi({ ...signedIn(), 'GET /api/results': () => json({ error: 'boom' }, 500) });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your results.');
  });
});

describe('recordAge', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const at = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();

  it.each([
    [0, null],
    [30, null],
    [31, 'record checked 4 weeks ago'],
    [59, 'record checked 8 weeks ago'],
    [60, 'record checked 2 months ago'],
    [364, 'record checked 12 months ago'],
    [365, 'record checked 1 year ago'],
    [800, 'record checked 2 years ago'],
  ])('%i days -> %s', (days, expected) => {
    expect(recordAge(at(days), now)).toBe(expected);
  });
});
