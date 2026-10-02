import { encodePolyline, type ResultRow, type Results } from '@mykom/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    expect(screen.getByText(/a dot alone is a Segment’s start only/)).toBeVisible();
  });

  it('labels the start and finish in the legend', () => {
    render(<SegmentMapPanel results={results} />);

    const legend = screen.getByText(/a dot alone is a Segment’s start only/);
    expect(legend).toHaveTextContent(
      '● Your targets ● Nearest misses · ● start ● finish · a dot alone is a Segment’s start only',
    );
    const dots = legend.querySelectorAll('[aria-hidden="true"]');
    expect([...dots].map((dot) => (dot as HTMLElement).style.color)).toEqual([
      'rgb(234, 88, 12)',
      'rgb(37, 99, 235)',
      'rgb(22, 163, 74)',
      'rgb(17, 24, 39)',
    ]);
  });

  it('draws routes, loops and start-only Segments without Leaflet errors', async () => {
    const errors = vi.spyOn(console, 'error');
    const start = { lat: 45.425, lng: -75.69 };
    const row = (segmentId: number, polyline: string | null): ResultRow => ({
      segmentId,
      name: `Segment ${segmentId}`,
      distance: 1000,
      averageGrade: 0.012,
      kmFromCentre: 0.6,
      athleteCount: 1200,
      record: 185,
      predicted: { seconds: 183.4, confidence: 'high', reason: 'within-range' },
      pb: 190,
      held: false,
      implausible: false,
      recordCheckedAt: new Date().toISOString(),
      start,
      polyline,
    });
    const loop = [start, { lat: 45.43, lng: -75.69 }, { lat: 45.43, lng: -75.68 }, start];
    render(
      <SegmentMapPanel
        results={{
          ...results,
          pending: false,
          targets: [row(1, encodePolyline([start, { lat: 45.43, lng: -75.685 }])), row(2, null)],
          nearestMisses: [row(3, encodePolyline(loop))],
        }}
      />,
    );

    const map = await screen.findByRole('region', { name: 'Segment map' });
    expect(map).toHaveAttribute('data-segment-count', '3');
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
