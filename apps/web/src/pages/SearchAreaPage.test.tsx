import type { GeocodeResult, LocateIpResponse, SearchArea, SearchAreaUpdate } from '@mykom/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../routes';
import { json, signedIn, stubApi } from '../test/api';
import { GEOLOCATION_TIMEOUT_MS } from './SearchAreaPage';

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

/** Echoes a PUT back as the saved Search Area, recording each body sent. */
function echoPut(bodies: SearchAreaUpdate[]) {
  return (init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as SearchAreaUpdate;
    bodies.push(body);
    return json({ searchArea: body });
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
}

const save = () => userEvent.click(screen.getByRole('button', { name: 'Save' }));

describe('Search Area', () => {
  it('restores the saved Search Area', async () => {
    const saved: SearchArea = { label: 'Leeds', lat: 53.8, lng: -1.55, radiusKm: 25 };
    stubApi({ ...signedIn(), 'GET /api/search-area': () => json({ searchArea: saved }) });
    renderPage();

    expect(await screen.findByTestId('saved-search-area')).toHaveTextContent(
      'Your Search Area: 25 km around Leeds',
    );
    expect(screen.getByRole('radio', { name: '25 km' })).toBeChecked();
    expect(screen.getByTestId('chosen-centre')).toHaveTextContent('Centre: Leeds');
  });

  it('offers every radius, with Save disabled until a centre is chosen', async () => {
    stubApi(signedIn());
    renderPage();

    expect(await screen.findByText('You haven’t set a Search Area yet.')).toBeVisible();
    for (const radius of [5, 10, 25, 50]) {
      expect(screen.getByRole('radio', { name: `${radius} km` })).toBeInTheDocument();
    }
    expect(screen.getByRole('radio', { name: '10 km' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
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
      'PUT /api/search-area': echoPut(bodies),
    });
    renderPage();

    await userEvent.type(await screen.findByLabelText('Place or postcode'), 'SW1A 1AA');
    // No autocomplete: nothing is searched while typing.
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/geocode'));
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    const found = await screen.findByRole('list', { name: 'Places found' });
    await userEvent.click(within(found).getByRole('button', { name: /^Buckingham Palace/ }));
    await userEvent.click(screen.getByRole('radio', { name: '5 km' }));
    await save();

    expect(await screen.findByRole('status')).toHaveTextContent('Search Area saved.');
    expect(bodies).toEqual([{ ...places[1], radiusKm: 5 }]);
    expect(screen.getByTestId('saved-search-area')).toHaveTextContent(
      'Your Search Area: 5 km around Buckingham Palace',
    );
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
    const fetchMock = stubApi({ ...signedIn(), 'PUT /api/search-area': echoPut(bodies) });
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
    expect(await screen.findByRole('status')).toHaveTextContent('Search Area saved.');
    expect(bodies).toEqual([{ label: 'My location', lat: 51.45, lng: -2.58, radiusKm: 10 }]);
  });

  it('falls back to the IP location when geolocation is denied, after confirmation', async () => {
    const bodies: SearchAreaUpdate[] = [];
    stubApi({
      ...signedIn(),
      'GET /api/locate-ip': () => json(leeds),
      'PUT /api/search-area': echoPut(bodies),
    });
    stubGeolocation(denied);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Use my location' }));

    const question = await screen.findByRole('group', { name: /Is this right\?/ });
    expect(question).toHaveTextContent('near Leeds, England, United Kingdom');
    // Not chosen until the Runner confirms it.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.click(within(question).getByRole('button', { name: 'Yes, use this' }));
    expect(screen.getByTestId('chosen-centre')).toHaveTextContent(
      'Centre: Leeds, England, United Kingdom',
    );
    await save();
    expect(await screen.findByRole('status')).toHaveTextContent('Search Area saved.');
    expect(bodies).toEqual([
      { label: 'Leeds, England, United Kingdom', lat: 53.8, lng: -1.55, radiusKm: 10 },
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
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
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

  it('reports a failed save', async () => {
    stubApi({ ...signedIn(), 'PUT /api/search-area': () => json({}, 500) });
    stubGeolocation(grantedAt(51.45, -2.58));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Use my location' }));
    await save();

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save your Search Area');
  });

  it('reports a failed load', async () => {
    stubApi({ ...signedIn(), 'GET /api/search-area': () => json({}, 500) });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your Search Area');
  });
});
