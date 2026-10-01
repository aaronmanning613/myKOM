import { describe, expect, it } from 'vitest';
import { generateFitnessProfile, type ProfileActivity } from './profile-generation.js';
import { parseTime } from './time.js';
import { vdotOf } from './vdot.js';

const NOW = new Date('2026-09-29T12:00:00Z');

function seconds(time: string): number {
  const parsed = parseTime(time);
  if (!parsed.ok) throw new Error(`bad time ${time}`);
  return parsed.seconds;
}

let nextId = 1;
function run(distance: number, movingTime: string, overrides: Partial<ProfileActivity> = {}) {
  return {
    id: nextId++,
    name: `Run ${nextId}`,
    sportType: 'Run',
    startDate: '2026-05-10T13:00:00Z',
    distance,
    movingTime: seconds(movingTime),
    ...overrides,
  } satisfies ProfileActivity;
}

function secondsAt(profile: ReturnType<typeof generateFitnessProfile>, id: string) {
  return profile?.benchmarks.find((b) => b.distance === id)?.seconds;
}

describe('generateFitnessProfile', () => {
  it('scores the test account (marathon 2:21:03 + 10K 30:39) at VDOT 71.1', () => {
    const marathon = run(42195, '2:21:03', { name: 'Toronto Waterfront Marathon' });
    const tenK = run(10000, '30:39', { name: 'Sporting Life 10K' });
    const easy = run(8000, '40:00');
    const profile = generateFitnessProfile([marathon, easy, tenK], NOW);

    expect(profile?.vdot).toBeCloseTo(71.1, 1);
    expect(profile?.sources.map((s) => s.activityId).sort()).toEqual([marathon.id, tenK.id].sort());
    expect(profile?.sources.map((s) => s.benchmark).sort()).toEqual(['10k', 'marathon']);
    expect(profile?.benchmarks).toHaveLength(13);
    expect(Math.abs(secondsAt(profile, '5k')! - seconds('14:43'))).toBeLessThanOrEqual(1);
    expect(Math.abs(secondsAt(profile, 'marathon')! - seconds('2:21:16'))).toBeLessThanOrEqual(1);
  });

  it('lists the best source run first', () => {
    const slow = run(5000, '15:30');
    const fast = run(10000, '30:39');
    const profile = generateFitnessProfile([slow, fast], NOW);
    expect(profile?.sources.map((s) => s.activityId)).toEqual([fast.id, slow.id]);
  });

  it('uses one race alone when the second-best run is more than 8 VDOT behind', () => {
    const race = run(10000, '30:39');
    const easy = run(5000, '25:00');
    expect(vdotOf(10000, seconds('30:39')) - vdotOf(5000, seconds('25:00'))).toBeGreaterThan(8);

    const profile = generateFitnessProfile([race, easy], NOW);
    expect(profile?.sources.map((s) => s.activityId)).toEqual([race.id]);
    expect(profile?.vdot).toBeCloseTo(vdotOf(10000, seconds('30:39')), 6);
    expect(secondsAt(profile, '10k')).toBe(seconds('30:39'));
  });

  it('averages the second run when it is within 8 VDOT', () => {
    const race = run(10000, '30:39');
    const tempo = run(5000, '15:30');
    const profile = generateFitnessProfile([race, tempo], NOW);
    expect(profile?.sources).toHaveLength(2);
    expect(profile?.vdot).toBeCloseTo(
      (vdotOf(10000, seconds('30:39')) + vdotOf(5000, seconds('15:30'))) / 2,
      6,
    );
  });

  it('takes the fastest run at each distance, so only the best two distances score', () => {
    const profile = generateFitnessProfile(
      [run(5000, '18:00'), run(5000, '16:00'), run(5000, '17:00'), run(10000, '34:00')],
      NOW,
    );
    expect(profile?.sources.map((s) => [s.benchmark, s.movingTime])).toEqual([
      ['5k', seconds('16:00')],
      ['10k', seconds('34:00')],
    ]);
  });

  it('returns null with no qualifying runs', () => {
    expect(generateFitnessProfile([], NOW)).toBeNull();
    expect(generateFitnessProfile([run(6500, '25:00'), run(12000, '50:00')], NOW)).toBeNull();
  });

  it('uses runs only', () => {
    const ride = run(10000, '15:00', { sportType: 'Ride' });
    const walk = run(5000, '14:00', { sportType: 'Walk' });
    expect(generateFitnessProfile([ride, walk], NOW)).toBeNull();

    const trail = run(10000, '40:00', { sportType: 'TrailRun' });
    expect(generateFitnessProfile([ride, trail], NOW)?.sources[0]?.activityId).toBe(trail.id);
  });

  it('ignores runs older than 3 years', () => {
    const old = run(5000, '15:00', { startDate: '2023-09-28T12:00:00Z' });
    const recent = run(5000, '18:00', { startDate: '2023-09-30T12:00:00Z' });
    expect(generateFitnessProfile([old], NOW)).toBeNull();
    expect(generateFitnessProfile([old, recent], NOW)?.sources[0]?.activityId).toBe(recent.id);
  });

  it('scores moving time, not elapsed time', () => {
    const withStops = { ...run(5000, '18:00'), elapsedTime: seconds('25:00') };
    const profile = generateFitnessProfile([withStops], NOW);
    expect(secondsAt(profile, '5k')).toBe(seconds('18:00'));
  });

  it('scales moving time to the Benchmark distance', () => {
    const long = run(5200, '18:12');
    const profile = generateFitnessProfile([long], NOW);
    expect(profile?.vdot).toBeCloseTo(vdotOf(5000, (seconds('18:12') * 5000) / 5200), 6);
    expect(secondsAt(profile, '5k')).toBe(Math.round((seconds('18:12') * 5000) / 5200));
  });

  it('ignores a run just outside the 0.98 D–1.06 D band', () => {
    expect(generateFitnessProfile([run(4899, '16:00')], NOW)).toBeNull();
    expect(generateFitnessProfile([run(5301, '16:00')], NOW)).toBeNull();
    expect(generateFitnessProfile([run(4900, '16:00')], NOW)).not.toBeNull();
    expect(generateFitnessProfile([run(5300, '16:00')], NOW)).not.toBeNull();
  });
});
