import type { Results } from '@mykom/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SegmentMapPanel } from './SegmentMapPanel';

// Its own file, so the map's lazy chunk isn't loaded yet when it renders.
const results: Results = {
  searchArea: { label: 'Ottawa, Ontario', lat: 45.42, lng: -75.69, radiusKm: 2 },
  recordGender: 'KOM',
  targets: [],
  nearestMisses: [],
  suspicious: [],
  achievableCount: 0,
  knownCount: 0,
  enoughBenchmarks: true,
  progress: null,
  pending: true,
  budget: { continuesTomorrow: false, pausedUntil: null },
};

describe('SegmentMapPanel', () => {
  it('holds the map’s height with a placeholder while Leaflet loads, then shows the map', async () => {
    render(<SegmentMapPanel results={results} />);

    const placeholder = screen.getByText('Loading the map…');
    expect(placeholder).toHaveClass('h-[260px]', 'sm:h-[400px]');
    expect(screen.queryByRole('region', { name: 'Segment map' })).not.toBeInTheDocument();

    expect(await screen.findByRole('region', { name: 'Segment map' })).toBeInTheDocument();
    expect(screen.queryByText('Loading the map…')).not.toBeInTheDocument();
    expect(screen.getByText(/a line is the whole Segment, a dot is its start/)).toBeVisible();
  });
});
