// PROTOTYPE (wayfinder: Onboarding and Fitness Profile editing UX, branch prototype/onboarding):
// three variants of the first run and the Benchmark edit screen, hosted on /fitness-profile and
// switchable via `?variant=A|B|C`. `?stage=first|returning` and `?profile=races|one|none` pick
// the fixture. All state is in memory.
import { useSearchParams } from 'react-router';
import { PrototypeSwitcher } from '../../PrototypeSwitcher';
import type { Scenario } from './data';
import { VariantA, VariantB, VariantC, type Stage } from './variants';

const NAMES = { A: 'Wizard', B: 'Straight to results', C: 'Checklist + evidence' };
const SCENARIOS: Scenario[] = ['races', 'one', 'none'];

export function OnboardingPrototype() {
  const [params, setParams] = useSearchParams();
  const variant = params.get('variant') ?? 'A';
  const stage: Stage = params.get('stage') === 'returning' ? 'returning' : 'first';
  const scenario = (SCENARIOS.find((s) => s === params.get('profile')) ?? 'races') as Scenario;
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        p.set(key, value);
        return p;
      },
      { replace: true },
    );
  // Remount on any fixture change so each variant restarts its flow.
  const key = `${variant}-${stage}-${scenario}`;

  return (
    <>
      {variant === 'A' && <VariantA key={key} stage={stage} scenario={scenario} />}
      {variant === 'B' && <VariantB key={key} stage={stage} scenario={scenario} />}
      {variant === 'C' && <VariantC key={key} stage={stage} scenario={scenario} />}
      <div className="h-16" />
      <PrototypeSwitcher variants={['A', 'B', 'C']} names={NAMES}>
        <span className="flex gap-3">
          <button
            type="button"
            onClick={() => set('stage', stage === 'first' ? 'returning' : 'first')}
          >
            Stage: {stage}
          </button>
          <button
            type="button"
            onClick={() =>
              set('profile', SCENARIOS[(SCENARIOS.indexOf(scenario) + 1) % SCENARIOS.length]!)
            }
          >
            Profile: {scenario}
          </button>
        </span>
      </PrototypeSwitcher>
    </>
  );
}
