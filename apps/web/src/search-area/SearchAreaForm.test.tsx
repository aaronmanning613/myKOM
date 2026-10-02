import type { LatLng, Results, SearchAreaUpdate } from '@mykom/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { json, stubApi } from '../test/api';
import { SearchAreaForm } from './SearchAreaForm';

// The map's chunk stands in for Leaflet: each button drops the pin at a point, as a map click or
// a drag would. Real clicking and dragging are covered in e2e.
vi.mock('./SearchAreaMap', () => ({
  default: ({ onPick }: { onPick: (point: LatLng) => void }) => (
    <>
      <button type="button" onClick={() => onPick({ lat: 53.8000049, lng: -1.5500051 })}>
        Drop in Leeds
      </button>
      <button type="button" onClick={() => onPick({ lat: 51.45, lng: -2.58 })}>
        Drop in Bristol
      </button>
    </>
  ),
}));

const reverseUrl = (lat: number, lng: number) => `GET /api/geocode/reverse?lat=${lat}&lng=${lng}`;

/** A reply the test sends when it chooses. */
function deferred() {
  let send: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => (send = resolve));
  return { handler: () => promise, send: (response: Response) => act(async () => send(response)) };
}

function renderForm(onSearched: (results: Results) => void = () => {}) {
  render(
    <SearchAreaForm
      initial={null}
      submitLabel="Save and see results"
      onSearched={onSearched}
      withMap
    />,
  );
}

const chosenCentre = () => screen.getByTestId('chosen-centre');
const drop = async (name: string) =>
  userEvent.click(await screen.findByRole('button', { name: `Drop in ${name}` }));

describe('SearchAreaForm with the map', () => {
  it('labels a dropped pin at once, then with the place name found for it', async () => {
    const leeds = deferred();
    const bodies: SearchAreaUpdate[] = [];
    stubApi({
      // Rounded to 5 decimal places.
      [reverseUrl(53.8, -1.55001)]: leeds.handler,
      'POST /api/search': (init) => {
        const body = JSON.parse(String(init?.body)) as SearchAreaUpdate;
        bodies.push(body);
        return json({ searchArea: body, targets: [], nearestMisses: [], suspicious: [] });
      },
    });
    const onSearched = vi.fn();
    renderForm(onSearched);

    await drop('Leeds');
    expect(chosenCentre()).toHaveTextContent('Centre: Dropped pin (finding the place name…)');
    expect(screen.getByRole('button', { name: 'Save and see results' })).toBeEnabled();

    await leeds.send(json({ result: { label: 'Leeds, England', lat: 53.7999, lng: -1.5501 } }));
    expect(chosenCentre()).toHaveTextContent(/^Centre: Leeds, England$/);

    await userEvent.click(screen.getByRole('button', { name: 'Save and see results' }));
    // The name is the place's; the centre stays where the pin is.
    expect(bodies).toEqual([{ label: 'Leeds, England', lat: 53.8, lng: -1.55001, radiusKm: 5 }]);
    expect(onSearched).toHaveBeenCalledOnce();
  });

  it('ends with the second pin’s name when it moves before the first is named', async () => {
    const leeds = deferred();
    const bristol = deferred();
    stubApi({
      [reverseUrl(53.8, -1.55001)]: leeds.handler,
      [reverseUrl(51.45, -2.58)]: bristol.handler,
    });
    renderForm();

    await drop('Leeds');
    await drop('Bristol');
    expect(chosenCentre()).toHaveTextContent('Centre: Dropped pin (finding the place name…)');

    await bristol.send(json({ result: { label: 'Bristol', lat: 51.45, lng: -2.58 } }));
    expect(chosenCentre()).toHaveTextContent(/^Centre: Bristol$/);
    await leeds.send(json({ result: { label: 'Leeds', lat: 53.8, lng: -1.55 } }));
    expect(chosenCentre()).toHaveTextContent(/^Centre: Bristol$/);
  });

  it('keeps “Dropped pin”, with no error, when the lookup fails or finds nothing', async () => {
    stubApi({
      [reverseUrl(53.8, -1.55001)]: () => json({ error: 'geocoding_unavailable' }, 503),
      [reverseUrl(51.45, -2.58)]: () => json({ result: null }),
    });
    renderForm();

    await drop('Leeds');
    await vi.waitFor(() => expect(chosenCentre()).toHaveTextContent(/^Centre: Dropped pin$/));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await drop('Bristol');
    await vi.waitFor(() => expect(chosenCentre()).toHaveTextContent(/^Centre: Dropped pin$/));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and see results' })).toBeEnabled();
  });
});
