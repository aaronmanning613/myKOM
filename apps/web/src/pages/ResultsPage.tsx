// PROTOTYPE (wayfinder #19, branch prototype/results-list): three variants of the Results page on
// the existing /results route, switchable via `?variant=A|B|C`, fed by in-memory fixture Segments
// with the Ranking rules computed client-side. `?runner=slow` shows the Nearest misses case.
import type { SearchRadiusKm } from '@mykom/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { PrototypeSwitcher } from '../PrototypeSwitcher';
import { rank, type Margin, type Runner } from './results-prototype/data';
import { VariantA, VariantB, VariantC } from './results-prototype/variants';

const NAMES = { A: 'Table', B: 'Gap-bar cards', C: 'Sentence + leaderboard' };

export function ResultsPage() {
  const [params, setParams] = useSearchParams();
  const variant = params.get('variant') ?? 'A';
  const runner: Runner = params.get('runner') === 'slow' ? 'slow' : 'fast';
  const [margin, setMargin] = useState<Margin>(5);
  const [radiusKm, setRadiusKm] = useState<SearchRadiusKm>(10);

  const props = {
    results: rank(runner, margin, radiusKm),
    margin,
    setMargin,
    radiusKm,
    setRadiusKm,
  };

  return (
    <>
      {variant === 'A' && <VariantA {...props} margin={5} />}
      {variant === 'B' && <VariantB {...props} />}
      {variant === 'C' && <VariantC {...props} />}
      <div className="h-16" />
      <PrototypeSwitcher variants={['A', 'B', 'C']} names={NAMES}>
        <button
          type="button"
          onClick={() =>
            setParams(
              (p) => {
                p.set('runner', runner === 'fast' ? 'slow' : 'fast');
                return p;
              },
              { replace: true },
            )
          }
        >
          Runner: {runner}
        </button>
      </PrototypeSwitcher>
    </>
  );
}
