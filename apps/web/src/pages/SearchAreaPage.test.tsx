import type {
  GeocodeResult,
  LocateIpResponse,
  MappedArea,
  MappedAreaCreate,
  SearchArea,
  SearchAreaUpdate,
} from '@mykom/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../routes';
import { json, signedIn, stubApi } from '../test/api';
import { MAPPED_AREAS_POLL_MS } from '../search-area/MappedAreas';
import { GEOLOCATION_TIMEOUT_MS } from '../search-area/PlacePicker';

const places: GeocodeResult[] = [
  { label: 'London, Greater London, England, SW1A 1AA, United Kingdom', lat: 51.501, lng: -0.1416 },
  { label: 'Buckingham Palace, London, SW1A 1AA, United Kingdom', lat: 51.5014, lng: -0.1419 },
];

const leeds: LocateIpResponse = {
  available: true,
  location: {
    label: 'Leeds, England, United Kingdom',
    lat: 53.8,
    lng: -1.55,
    accuracyRadiusKm: 20,
  },
};

/** Answers a search with the saved Search Area (and no Segments), recording each body sent. */
function echoSearch(bodies: SearchAreaUpdate[]) {
  return (init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as SearchAreaUpdate;
    bodies.push(body);
    return json({ searchArea: body, targets: [], nearestMisses: [], suspicious: [] });
  };
}

type GetCurrentPosition = Geolocation['getCurrentPosition'];

function stubGeolocation(getCurrentPosition: GetCurrentPosition) {
  const mock = vi.fn(getCurrentPosition);
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition: mock },
    configurable: true,
  });
  return mock;
}

const grantedAt =
  (latitude: number, longitude: number): GetCurrentPosition =>
  (success) =>
    success({ coords: { latitude, longitude } } as GeolocationPosition);

const denied: GetCurrentPosition = (_success, error) =>
  error?.({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError);

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation');
});

function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/search-area'] });
  render(<RouterProvider router={router} />);
  return router;
}

const saveButton = () => screen.getByRole('button', { name: 'Save and see results' });
const save = () => userEvent.click(saveButton());

describe('Search Area', () => {
  // First in the file, so the map's lazy chunk isn't loaded yet when the page renders.
  it('shows a placeholder while the map loads, then the map and its hint', async () => {
    const saved: SearchArea = { label: 'Leeds', lat: 53.8, lng: -1.55, radiusKm: 2 };
    stubApi({ ...signedIn(), 'GET /api/search-area': () => json({ searchArea: saved }) });
    renderPage();

    const centre = within(await screen.findByRole('region', { name: 'Centre' }));
    const placeholder = centre.getByText('Loading the map…');
    expect(placeholder).toHaveClass('h-[260px]', 'sm:h-[400px]');
    // The form never waits for the map.
    expect(saveButton()).toBeEnabled();

    expect(await centre.findByRole('region', { name: 'Search Area map' })).toBeInTheDocument();
    expect(centre.queryByText('Loading the map…')).not.toBeInTheDocument();
    expect(
      centre.getByText('Tap or click the map to drop the pin, then drag it to fine-tune.'),
    ).toBeVisible();
  });

  it('restores the saved Search Area', async () => {
    const saved: SearchArea = { label: 'Leeds', lat: 53.8, lng: -1.55, radiusKm: 2 };
    stubApi({ ...signedIn(), 'GET /api/search-area': () => json({ searchArea: saved }) });
    renderPage();

    expect(await screen.findByTestId('saved-search-area')).toHaveTextContent(
      'Your Search Area: 2 km around Leeds',
    );
    expect(
      within(screen.getByRole('group', { name: 'Radius' })).getByRole('radio', { name: '2 km' }),
    ).toBeChecked();
    expect(screen.getByTestId('chosen-centre')).toHaveTextContent('Centre: Leeds');
  });

  it('offers every radius, with Save disabled until a centre is chosen', async () => {
    stubApi(signedIn());
    renderPage();

    expect(await screen.findByText('You haven’t set a Search Area yet.')).toBeVisible();
    const radius = screen.getByRole('group', { name: 'Radius' });
    for (const km of [1, 2, 5, 10]) {
      expect(within(radius).getByRole('radio', { name: `${km} km` })).toBeInTheDocument();
    }
    expect(within(radius).getByRole('radio', { name: '5 km' })).toBeChecked();
    expect(within(radius).getByRole('radio', { name: '10 km' })).toHaveAccessibleDescription(
      '10 km is slower, and uses more of the daily budget.',
    );
    expect(within(radius).getByRole('radio', { name: '2 km' })).not.toHaveAccessibleDescription();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole('link', { name: 'OpenStreetMap contributors' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
  });

  it('searches a postcode on submit, picks a result and saves it with the radius', async () => {
    const bodies: SearchAreaUpdate[] = [];
    const fetchMock = stubApi({
      ...signedIn(),
      'GET /api/geocode?q=SW1A+1AA': () => json({ results: places }),
      'POST /api/search': echoSearch(bodies),
    });
    const router = renderPage();

    await userEvent.type(await screen.findByLabelText('Place or postcode'), 'SW1A 1AA');
    // No autocomplete: nothing is searched while typing.
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/geocode'));
    const centre = within(screen.getByRole('region', { name: 'Centre' }));
    await userEvent.click(centre.getByRole('button', { name: 'Search' }));

    const found = await centre.findByRole('list', { name: 'Places found' });
    await userEvent.click(within(found).getByRole('button', { name: /^Buckingham Palace/ }));
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Radius' })).getByRole('radio', { name: '1 km' }),
    );
    await save();

    expect(await screen.findByRole('heading', { name: 'Results' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/results');
    expect(bodies).toEqual([{ ...places[1], radiusKm: 1 }]);
  });

  it('chooses the first place found at once, and another can still be picked', async () => {
    const bodies: SearchAreaUpdate[] = [];
    stubApi({
      ...signedIn(),
      'GET /api/geocode?q=SW1A+1AA': () => json({ results: places }),
      'POST /api/search': echoSearch(bodies),
    });
    renderPage();

    await userEvent.type(await screen.findByLabelText('Place or postcode'), 'SW1A 1AA{Enter}');
    const found = await screen.findByRole('list', { name: 'Places found' });
    expect(screen.getByTestId('chosen-centre')).toHaveTextContent(`Centre: ${places[0]!.label}`);
    expect(within(found).getByRole('button', { name: /^London/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(saveButton()).toBeEnabled();

    await userEvent.click(within(found).getByRole('button', { name: /^Buckingham Palace/ }));
    expect(screen.getByTestId('chosen-centre')).toHaveTextContent(`Centre: ${places[1]!.label}`);
    await save();
    expect(await screen.findByRole('heading', { name: 'Results' })).toBeVisible();
    expect(bodies).toEqual([{ ...places[1], radiusKm: 5 }]);
  });

  it('says when no places match, and when search fails', async () => {
    stubApi({
      ...signedIn(),
      'GET /api/geocode?q=Nowhere': () => json({ results: [] }),
      'GET /api/geocode?q=Leeds': () => json({ error: 'geocode_failed' }, 502),
    });
    renderPage();

    const input = await screen.findByLabelText('Place or postcode');
    await userEvent.type(input, 'Nowhere{Enter}');
    expect(await screen.findByText('No places found for “Nowhere”.')).toBeVisible();

    await userEvent.clear(input);
    await userEvent.type(input, 'Leeds{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Place search failed');
  });

  it('uses the browser location, with a finite timeout', async () => {
    const bodies: SearchAreaUpdate[] = [];
    const fetchMock = stubApi({ ...signedIn(), 'POST /api/search': echoSearch(bodies) });
    const getCurrentPosition = stubGeolocation(grantedAt(51.45, -2.58));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Use my location' }));

    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ timeout: GEOLOCATION_TIMEOUT_MS }),
    );
    expect(await screen.findByTestId('chosen-centre')).toHaveTextContent('Centre: My location');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/locate-ip');

    await save();
    expect(await screen.findByRole('heading', { name: 'Results' })).toBeVisible();
    expect(bodies).toEqual([{ label: 'My location', lat: 51.45, lng: -2.58, radiusKm: 5 }]);
  });

  it('falls back to the IP location when geolocation is denied, after confirmation', async () => {
    const bodies: SearchAreaUpdate[] = [];
    stubApi({
      ...signedIn(),
      'GET /api/locate-ip': () => json(leeds),
      'POST /api/search': echoSearch(bodies),
    });
    stubGeolocation(denied);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Use my location' }));

    const question = await screen.findByRole('group', { name: /Is this right\?/ });
    expect(question).toHaveTextContent('near Leeds, England, United Kingdom');
    // Not chosen until the Runner confirms it.
    expect(saveButton()).toBeDisabled();

    await userEvent.click(within(question).getByRole('button', { name: 'Yes, use this' }));
    expect(screen.getByTestId('chosen-centre')).toHaveTextContent(
      'Centre: Leeds, England, United Kingdom',
    );
    await save();
    expect(await screen.findByRole('heading', { name: 'Results' })).toBeVisible();
    expect(bodies).toEqual([
      { label: 'Leeds, England, United Kingdom', lat: 53.8, lng: -1.55, radiusKm: 5 },
    ]);
  });

  it('falls back to the IP location without a Geolocation API, and can be rejected', async () => {
    stubApi({ ...signedIn(), 'GET /api/locate-ip': () => json(leeds) });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Use my location' }));
    await userEvent.click(await screen.findByRole('button', { name: 'No' }));

    expect(screen.queryByRole('group', { name: /Is this right\?/ })).not.toBeInTheDocument();
    expect(screen.getByText('Search for your place or postcode instead.')).toBeVisible();
    expect(screen.getByLabelText('Place or postcode')).toHaveFocus();
    expect(saveButton()).toBeDisabled();
  });

  it('says so when neither the browser nor the IP lookup can find the Runner', async () => {
    stubApi({
      ...signedIn(),
      'GET /api/locate-ip': () => json({ available: false, reason: 'no_database' }),
    });
    stubGeolocation(denied);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Use my location' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t find your location');
  });

  it('hides the IP fallback when the server has it off, as in production', async () => {
    stubApi({
      ...signedIn(),
      'GET /api/locate-ip': () => json({ available: false, reason: 'disabled' }),
    });
    stubGeolocation(denied);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Use my location' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t find your location. Search for your place or postcode instead.',
    );
    expect(screen.queryByRole('group', { name: /Is this right\?/ })).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('shows that it is searching while the first burst runs', async () => {
    let answer: (response: Response) => void = () => {};
    stubApi({
      ...signedIn(),
      'POST /api/search': () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    stubGeolocation(grantedAt(51.45, -2.58));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Use my location' }));
    await save();

    expect(screen.getByRole('button', { name: 'Searching your Known Segments…' })).toBeDisabled();
    await act(async () => answer(json({ searchArea: null })));
    expect(await screen.findByRole('heading', { name: 'Results' })).toBeVisible();
  });

  it('reports a failed save', async () => {
    stubApi({ ...signedIn(), 'POST /api/search': () => json({}, 500) });
    stubGeolocation(grantedAt(51.45, -2.58));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Use my location' }));
    await save();

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t search your Search Area');
    expect(saveButton()).toBeEnabled();
  });

  it('reports a failed load', async () => {
    stubApi({ ...signedIn(), 'GET /api/search-area': () => json({}, 500) });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your Search Area');
  });
});

function mappedArea(overrides: Partial<MappedArea> & { id: number; label: string }): MappedArea {
  return {
    lat: 53.8,
    lng: -1.55,
    radiusKm: 25,
    createdAt: '2026-09-28T10:00:00.000Z',
    progress: {
      status: 'running',
      runsChecked: 12,
      runsTotal: 40,
      segmentsChecked: 20,
      segmentsTotal: 31,
      segmentsFound: 31,
      coverage: 0.42,
    },
    ...overrides,
  };
}

const runningProgress = mappedArea({ id: 0, label: '' }).progress;

const mappedSection = () =>
  screen.findByRole('region', { name: 'Map a whole area in the background' });

describe('Mapped Areas', () => {
  it('lists each Mapped Area with a progress bar', async () => {
    stubApi({
      ...signedIn(),
      'GET /api/mapped-areas': () =>
        json({
          mappedAreas: [
            mappedArea({ id: 2, label: 'Leeds' }),
            mappedArea({
              id: 1,
              label: 'York',
              radiusKm: 10,
              progress: { ...runningProgress, status: 'done', segmentsTotal: 1 },
            }),
          ],
        }),
    });
    renderPage();

    const list = await within(await mappedSection()).findByRole('list', { name: 'Mapped Areas' });
    const [leeds, york] = within(list).getAllByRole('listitem');
    expect(leeds).toHaveTextContent('Leeds · 25 km');
    expect(within(leeds!).getByRole('progressbar', { name: 'Mapping Leeds' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
    expect(leeds).toHaveTextContent('12 of ~40 runs checked · 31 Known Segments');
    expect(york).toHaveTextContent('York · 10 km');
    expect(within(york!).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(york).toHaveTextContent('Done · 1 Known Segment');
  });

  it('starts mapping a place with the chosen radius, 25 km by default', async () => {
    const bodies: MappedAreaCreate[] = [];
    stubApi({
      ...signedIn(),
      'GET /api/geocode?q=Leeds': () => json({ results: [places[0]] }),
      'POST /api/mapped-areas': (init) => {
        const body = JSON.parse(String(init?.body)) as MappedAreaCreate;
        bodies.push(body);
        return json(mappedArea({ ...body, id: 7 }), 201);
      },
    });
    renderPage();

    const section = within(await mappedSection());
    const start = section.getByRole('button', { name: 'Start mapping' });
    expect(start).toBeDisabled();
    const radius = section.getByRole('group', { name: 'Mapped Area radius' });
    expect(
      within(radius)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('value')),
    ).toEqual(['10', '25', '50']);
    expect(within(radius).getByRole('radio', { name: '25 km' })).toBeChecked();
    // Mapping takes a place, not "Use my location".
    expect(section.queryByRole('button', { name: 'Use my location' })).not.toBeInTheDocument();

    await userEvent.type(section.getByLabelText('Place to map'), 'Leeds{Enter}');
    await userEvent.click(
      within(await section.findByRole('list', { name: 'Places found' })).getByRole('button'),
    );
    await userEvent.click(within(radius).getByRole('radio', { name: '50 km' }));
    await userEvent.click(start);

    expect(bodies).toEqual([{ ...places[0], radiusKm: 50 }]);
    const list = await section.findByRole('list', { name: 'Mapped Areas' });
    expect(within(list).getByRole('listitem')).toHaveTextContent(`${places[0]!.label} · 50 km`);
    // The Search Area form is untouched.
    expect(screen.getByTestId('chosen-centre')).toHaveTextContent(
      'Search for a place or use your location',
    );
  });

  it('removes a Mapped Area', async () => {
    const fetchMock = stubApi({
      ...signedIn(),
      'GET /api/mapped-areas': () => json({ mappedAreas: [mappedArea({ id: 3, label: 'Leeds' })] }),
      'DELETE /api/mapped-areas/3': () => new Response(null, { status: 204 }),
    });
    renderPage();

    const section = within(await mappedSection());
    await userEvent.click(await section.findByRole('button', { name: 'Remove Leeds' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/mapped-areas/3', { method: 'DELETE' });
    expect(section.queryByRole('list', { name: 'Mapped Areas' })).not.toBeInTheDocument();
  });

  it('keeps a Mapped Area it couldn’t remove, and says so', async () => {
    stubApi({
      ...signedIn(),
      'GET /api/mapped-areas': () => json({ mappedAreas: [mappedArea({ id: 3, label: 'Leeds' })] }),
      'DELETE /api/mapped-areas/3': () => json({}, 500),
    });
    renderPage();

    const section = within(await mappedSection());
    await userEvent.click(await section.findByRole('button', { name: 'Remove Leeds' }));

    expect(await section.findByRole('alert')).toHaveTextContent('Couldn’t remove Leeds');
    expect(section.getByRole('list', { name: 'Mapped Areas' })).toBeInTheDocument();
  });

  it('refreshes progress while an area is still running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let coverage = 0.1;
      stubApi({
        ...signedIn(),
        'GET /api/mapped-areas': () =>
          json({
            mappedAreas: [
              mappedArea({ id: 3, label: 'Leeds', progress: { ...runningProgress, coverage } }),
            ],
          }),
      });
      renderPage();

      const bar = await within(await mappedSection()).findByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '10');
      coverage = 0.6;
      await act(() => vi.advanceTimersByTimeAsync(MAPPED_AREAS_POLL_MS));
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
    } finally {
      vi.useRealTimers();
    }
  });
});
