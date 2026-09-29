import type { FitnessProfile, FitnessProfileUpdate } from '@mykom/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../routes';
import { json, signedIn, stubApi } from '../test/api';

const saved: FitnessProfile = {
  benchmarks: [
    {
      distance: '1k',
      seconds: 222,
      source: 'runner',
      generatedSeconds: null,
      soft: false,
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      distance: '5k',
      seconds: 1200,
      source: 'generated',
      generatedSeconds: 1200,
      soft: false,
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ],
  generation: null,
  suggestion: null,
};

/** Echoes a PUT back as the saved profile, recording each body sent. */
function echoPut(bodies: FitnessProfileUpdate[]) {
  return (init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as FitnessProfileUpdate;
    bodies.push(body);
    return json({
      benchmarks: body.benchmarks.map((b) => ({ ...b, source: 'runner', updatedAt: '' })),
    });
  };
}

function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/fitness-profile'] });
  render(<RouterProvider router={router} />);
}

const timeInput = (label: string) => screen.findByLabelText(label);

describe('Fitness Profile', () => {
  it('shows one row per Benchmark distance, filled from the saved profile, with pace', async () => {
    stubApi({ ...signedIn(), 'GET /api/fitness-profile': () => json(saved) });
    renderPage();

    const labels = ['400m', '800m', '1K', '1 mile', '3K', '5K', '8K', '10K', '15K', '10 mile'];
    for (const label of [...labels, 'Half marathon', '30K', 'Marathon']) {
      expect(await timeInput(label)).toBeVisible();
    }
    expect(screen.getAllByRole('textbox')).toHaveLength(13);
    expect(await timeInput('1K')).toHaveValue('3:42');
    expect(await timeInput('1K')).toHaveAccessibleDescription('3:42/km');
    expect(await timeInput('5K')).toHaveValue('20:00');
    expect(await timeInput('5K')).toHaveAccessibleDescription('4:00/km');
    expect(await timeInput('10K')).toHaveValue('');
  });

  it('shows the pace as a time is typed', async () => {
    stubApi(signedIn());
    renderPage();

    await userEvent.type(await timeInput('10K'), '45:00');

    expect(await timeInput('10K')).toHaveAccessibleDescription('4:30/km');
  });

  it('saves edited, cleared and new Benchmarks', async () => {
    const bodies: FitnessProfileUpdate[] = [];
    stubApi({
      ...signedIn(),
      'GET /api/fitness-profile': () => json(saved),
      'PUT /api/fitness-profile': echoPut(bodies),
    });
    renderPage();

    const oneK = await timeInput('1K');
    await userEvent.clear(oneK);
    await userEvent.type(oneK, '3:30');
    await userEvent.click(screen.getByRole('button', { name: 'Clear 5K' }));
    await userEvent.type(await timeInput('400m'), '75');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Fitness Profile saved.');
    expect(bodies).toEqual([
      {
        benchmarks: [
          { distance: '400m', seconds: 75 },
          { distance: '1k', seconds: 210 },
        ],
      },
    ]);
    // The saved times come back normalised.
    expect(await timeInput('400m')).toHaveValue('1:15');
    expect(await timeInput('5K')).toHaveValue('');
  });

  it('shows inline errors for invalid times and doesn’t save', async () => {
    const bodies: FitnessProfileUpdate[] = [];
    stubApi({ ...signedIn(), 'PUT /api/fitness-profile': echoPut(bodies) });
    renderPage();

    const mile = await timeInput('1 mile');
    await userEvent.type(mile, '5:75');
    await userEvent.tab();

    expect(mile).toHaveAttribute('aria-invalid', 'true');
    expect(mile).toHaveAccessibleDescription('Minutes and seconds must be under 60');

    await userEvent.type(await timeInput('10K'), 'abc');
    await userEvent.type(await timeInput('Marathon'), '25:00:00');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await timeInput('10K')).toHaveAccessibleDescription(
      'Enter a time like 75, 3:42 or 1:05:10',
    );
    expect(await timeInput('Marathon')).toHaveAccessibleDescription('Time must be under 24 hours');
    expect(mile).toHaveFocus();
    expect(bodies).toEqual([]);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('clears an error once the time is fixed', async () => {
    stubApi(signedIn());
    renderPage();

    const fiveK = await timeInput('5K');
    await userEvent.type(fiveK, '20:0');
    await userEvent.tab();
    expect(fiveK).toHaveAttribute('aria-invalid', 'true');

    await userEvent.type(fiveK, '0');

    expect(fiveK).not.toHaveAttribute('aria-invalid');
    expect(fiveK).toHaveAccessibleDescription('4:00/km');
  });

  it('reports a failed save and keeps the entered times', async () => {
    stubApi({ ...signedIn(), 'PUT /api/fitness-profile': () => json({}, 500) });
    renderPage();

    await userEvent.type(await timeInput('5K'), '19:59');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save');
    expect(await timeInput('5K')).toHaveValue('19:59');
  });

  it('reports a failed load', async () => {
    stubApi({ ...signedIn(), 'GET /api/fitness-profile': () => json({}, 500) });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t load your Fitness Profile',
    );
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
