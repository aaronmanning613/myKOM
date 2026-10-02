import type { ResultRow, Results, SearchAreaUpdate } from '@mykom/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { recordAge, ResultsSection } from '../results/ResultsSection';
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

  it('links every row in all three lists to its Segment on Strava', async () => {
    stubApi({
      ...signedIn(),
      'GET /api/results': () => json({ ...fast, nearestMisses: slow.nearestMisses }),
    });
    renderPage();

    await screen.findByRole('row', { name: /Canal Dash/ });
    for (const [segmentId, name] of [
      [1, 'Canal Dash'],
      [2, 'Bridge Sprint'],
      [3, 'Parliament Hill'],
      [11, 'Closest Miss'],
      [4, 'Glitchy Straight'],
    ] as const) {
      const link = within(rowFor(name)).getByRole('link', { name: `View ${name} on Strava` });
      expect(link).toHaveTextContent(/^View on Strava$/);
      expect(link).toHaveAttribute('href', `https://www.strava.com/segments/${segmentId}`);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
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

// Leaflet's drawing is covered in e2e (real Chrome); here, what React renders around it.
describe('the Segment map', () => {
  const LEGEND =
    /Your targets.*Nearest misses ·\s+start\s+finish · a dot alone is a Segment’s start only/;
  const map = () => screen.queryByRole('region', { name: 'Segment map' });

  // The placeholder is covered in SegmentMapPanel.test.tsx: by now the lazy chunk is cached.
  it('shows the map and its legend above the lists', async () => {
    stubApi({ ...signedIn(), 'GET /api/results': () => json(fast) });
    renderPage();

    const region = await screen.findByRole('region', { name: 'Segment map' });
    expect(screen.getByText(LEGEND)).toBeVisible();
    expect(
      region.compareDocumentPosition(section('Your targets')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows no map with no rows to draw and nothing pending', async () => {
    // Suspicious records aren't drawn, so they don't bring the map on their own.
    stubApi({
      ...signedIn(),
      'GET /api/results': () => json(results({ suspicious: fast.suspicious })),
    });
    renderPage();

    expect(await screen.findByText(/No targets within 2 km yet/)).toBeVisible();
    expect(map()).not.toBeInTheDocument();
    expect(screen.queryByText('Loading the map…')).not.toBeInTheDocument();
    expect(screen.queryByText(LEGEND)).not.toBeInTheDocument();
  });

  it('shows the map (just the Search Area) while a search is pending with no rows yet', async () => {
    stubApi({
      ...signedIn(),
      'GET /api/results': () =>
        json(
          results({
            pending: true,
            progress: null,
            budget: { continuesTomorrow: true, pausedUntil: null },
          }),
        ),
    });
    renderPage();

    expect(await screen.findByRole('region', { name: 'Segment map' })).toBeInTheDocument();
    expect(screen.getByText(LEGEND)).toBeVisible();
    expect(screen.getByText('None yet: your Segments are still being checked.')).toBeVisible();
  });

  it('gives Your targets and Nearest misses rows a "Show on map" button, not Suspicious records', async () => {
    // jsdom has no scrollIntoView.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    onTestFinished(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });
    stubApi({
      ...signedIn(),
      'GET /api/results': () => json({ ...fast, nearestMisses: slow.nearestMisses }),
    });
    renderPage();

    await screen.findByRole('region', { name: 'Segment map' });
    for (const name of ['Canal Dash', 'Bridge Sprint', 'Parliament Hill', 'Closest Miss']) {
      const button = within(rowFor(name)).getByRole('button', { name: `Show ${name} on map` });
      expect(button).toHaveTextContent(/^Show on map$/);
    }
    expect(
      within(section('Suspicious records')).queryByRole('button', { name: /on map/ }),
    ).not.toBeInTheDocument();

    // It brings the map into view without jumping past it.
    await userEvent.click(screen.getByRole('button', { name: 'Show Closest Miss on map' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(scrollIntoView.mock.contexts[0]).toContainElement(map());
  });
});

describe('paged lists', () => {
  const many = (n: number, prefix: string, from = 100) =>
    Array.from({ length: n }, (_, i) => row({ segmentId: from + i, name: `${prefix} ${i + 1}` }));
  const bodyRows = (name: string) => within(section(name)).getAllByRole('row').length - 1;
  const showMore = (button: string, list: string) =>
    userEvent.click(screen.getByRole('button', { name: `${button} ${list}` }));

  it('shows 20 of 47 targets, then 40, then all 47, with the full total in the heading', async () => {
    stubApi({ ...signedIn(), 'GET /api/results': () => json(results({ targets: many(47, 'T') })) });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Your targets (47)' })).toBeVisible();
    expect(bodyRows('Your targets')).toBe(20);
    expect(within(section('Your targets')).getByText('Showing 20 of 47')).toBeVisible();
    // Ranked order: the first page is the first 20 rows.
    expect(screen.getByRole('row', { name: /T 20\b/ })).toBeVisible();
    expect(screen.queryByRole('row', { name: /T 21\b/ })).not.toBeInTheDocument();

    await showMore('Show 20 more', 'Your targets');
    expect(bodyRows('Your targets')).toBe(40);
    expect(screen.getByText('Showing 40 of 47')).toBeVisible();
    const last = screen.getByRole('button', { name: 'Show 7 more Your targets' });
    expect(last).toHaveTextContent(/^Show 7 more$/);

    await userEvent.click(last);
    expect(bodyRows('Your targets')).toBe(47);
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Show \d+ more/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your targets (47)' })).toBeVisible();
  });

  it('keeps the shown count through a poll that reorders the list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const targets = many(47, 'T');
    const refining = results({ targets, pending: true });
    const responses = [refining, { ...refining, targets: [...targets].reverse() }];
    stubApi({
      ...signedIn(),
      'GET /api/results': () => json(responses.shift() ?? { ...refining, pending: false }),
    });
    renderPage();

    await screen.findByText('Showing 20 of 47');
    await showMore('Show 20 more', 'Your targets');
    expect(bodyRows('Your targets')).toBe(40);

    await act(() => vi.advanceTimersByTimeAsync(RESULTS_POLL_MS));
    // Reversed: T 47 now leads, and 40 rows still show.
    expect(await screen.findByRole('row', { name: /T 47\b/ })).toBeVisible();
    expect(bodyRows('Your targets')).toBe(40);
    expect(screen.getByText('Showing 40 of 47')).toBeVisible();
  });

  it('resets to 20 when the radius changes', async () => {
    stubApi({
      ...signedIn(),
      'GET /api/results': () => json(results({ targets: many(47, 'T') })),
      'POST /api/search': () =>
        json(results({ targets: many(47, 'T'), searchArea: { ...fast.searchArea, radiusKm: 5 } })),
    });
    renderPage();

    await screen.findByText('Showing 20 of 47');
    await showMore('Show 20 more', 'Your targets');
    expect(bodyRows('Your targets')).toBe(40);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Radius' }), '5');
    expect(await screen.findByText('Showing 20 of 47')).toBeVisible();
    expect(bodyRows('Your targets')).toBe(20);
  });

  it('pages Suspicious records separately from targets', async () => {
    stubApi({
      ...signedIn(),
      'GET /api/results': () =>
        json(
          results({
            targets: many(25, 'T'),
            suspicious: many(30, 'S', 500).map((r) => ({ ...r, implausible: true })),
          }),
        ),
    });
    renderPage();

    await screen.findByRole('heading', { name: 'Suspicious records (30)' });
    expect(bodyRows('Your targets')).toBe(20);
    expect(bodyRows('Suspicious records')).toBe(20);

    await showMore('Show 10 more', 'Suspicious records');
    expect(bodyRows('Suspicious records')).toBe(30);
    expect(bodyRows('Your targets')).toBe(20);
    expect(screen.getByRole('button', { name: 'Show 5 more Your targets' })).toBeVisible();
  });

  describe('the Segment map', () => {
    const map = () => screen.getByRole('region', { name: 'Segment map' });

    it('draws only the shown rows: 20 of 47 targets, then 40 after "Show more"', async () => {
      stubApi({
        ...signedIn(),
        'GET /api/results': () =>
          json(results({ targets: many(47, 'T'), nearestMisses: many(3, 'M', 500) })),
      });
      renderPage();

      expect(await screen.findByRole('region', { name: 'Segment map' })).toHaveAttribute(
        'data-segment-count',
        String(20 + 3),
      );
      await showMore('Show 20 more', 'Your targets');
      expect(map()).toHaveAttribute('data-segment-count', String(40 + 3));
      await showMore('Show 7 more', 'Your targets');
      expect(map()).toHaveAttribute('data-segment-count', String(47 + 3));
    });

    it('clears the selection when a poll pushes the selected Segment past the shown rows', async () => {
      // jsdom has no scrollIntoView.
      Element.prototype.scrollIntoView = vi.fn();
      onTestFinished(() => {
        delete (Element.prototype as Partial<Element>).scrollIntoView;
      });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const targets = many(47, 'T');
      const refining = results({ targets, pending: true });
      const responses = [refining, { ...refining, targets: [...targets].reverse() }];
      stubApi({
        ...signedIn(),
        'GET /api/results': () => json(responses.shift() ?? { ...refining, pending: false }),
      });
      renderPage();

      await userEvent.click(await screen.findByRole('button', { name: 'Show T 5 on map' }));
      expect(map()).toHaveAttribute('data-selected-segment', '104');

      // Reversed, T 5 is 43rd: still in the list, but past the 20 shown.
      await act(() => vi.advanceTimersByTimeAsync(RESULTS_POLL_MS));
      expect(await screen.findByRole('row', { name: /T 47\b/ })).toBeVisible();
      expect(screen.queryByRole('row', { name: /T 5\b/ })).not.toBeInTheDocument();
      expect(map()).not.toHaveAttribute('data-selected-segment');
    });
  });
});

describe('ResultsSection', () => {
  it('calls onShowOnMap with the row’s Segment id', async () => {
    const onShowOnMap = vi.fn();
    render(
      <ResultsSection
        title="Your targets"
        rows={fast.targets}
        now={new Date()}
        onShowOnMap={onShowOnMap}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Show Parliament Hill on map' }));
    expect(onShowOnMap).toHaveBeenCalledWith(3);
  });

  it('has no "Show on map" button without onShowOnMap', () => {
    render(<ResultsSection title="Your targets" rows={fast.targets} now={new Date()} />);

    expect(screen.getByRole('row', { name: /Canal Dash/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /on map/ })).not.toBeInTheDocument();
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
