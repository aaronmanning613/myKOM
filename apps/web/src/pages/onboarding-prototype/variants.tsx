// PROTOTYPE, throwaway (wayfinder: Onboarding and Fitness Profile editing UX): three
// structurally different takes on the first-run experience and the Benchmark edit screen.
// A = step-by-step wizard, B = straight to results with an "Adjust" drawer,
// C = non-blocking checklist plus an evidence-first profile page.
import { formatTime, parseTime } from '@mykom/shared';
import { useState } from 'react';
import {
  TARGETS,
  effective,
  generate,
  label,
  rowsFor,
  useCrawl,
  useFakeDelay,
  type DistanceId,
  type Generation,
  type Row,
  type Scenario,
} from './data';

export type Stage = 'first' | 'returning';
type Pins = Partial<Record<DistanceId, number>>;

function usePins() {
  const [pins, setPins] = useState<Pins>({});
  const pin = (id: DistanceId, seconds: number | null) =>
    setPins((p) => {
      const next = { ...p };
      if (seconds === null) delete next[id];
      else next[id] = seconds;
      return next;
    });
  return { pins, pin };
}

function t(seconds: number | null) {
  return seconds === null ? '—' : formatTime(seconds);
}

function TimeInput({
  value,
  onCommit,
  className = '',
}: {
  value: number | null;
  onCommit: (seconds: number | null) => void;
  className?: string;
}) {
  const [text, setText] = useState(value === null ? '' : formatTime(value));
  const [bad, setBad] = useState(false);
  return (
    <input
      value={text}
      placeholder="m:ss"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() === '') return onCommit(null);
        const parsed = parseTime(text);
        setBad(!parsed.ok);
        if (parsed.ok && parsed.seconds !== value) onCommit(parsed.seconds);
      }}
      className={`w-24 rounded border px-2 py-1 ${bad ? 'border-red-600' : 'border-gray-300'} ${className}`}
    />
  );
}

function Sources({ gen }: { gen: Generation }) {
  if (gen.vdot === null)
    return (
      <p className="text-gray-700">
        We didn’t find any race-like runs in your last 3 years, so there’s nothing to estimate from.
        Enter at least two times you could run today.
      </p>
    );
  return (
    <p className="text-gray-700">
      Estimated from{' '}
      {gen.scoring.map((r, i) => (
        <span key={r.name}>
          {i > 0 && ' and '}
          <strong>{r.name}</strong> ({t(r.movingSeconds)}, {r.date.slice(0, 7)})
        </span>
      ))}
      {gen.scoring.length === 1 && ', your only race-like run'}. Change anything that looks off.
    </p>
  );
}

function SearchAreaStub({ onStart }: { onStart: () => void }) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium">Place or postcode</span>
        <input
          defaultValue="High Park, Toronto"
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
        />
      </label>
      <button type="button" className="text-sm text-orange-700 underline">
        Use my location
      </button>
      <div className="flex items-center gap-2 text-sm">
        Radius
        {[2, 5, 10, 20].map((r) => (
          <span
            key={r}
            className={`rounded border px-2 py-0.5 ${r === 5 ? 'border-orange-600 bg-orange-50' : 'border-gray-300'}`}
          >
            {r} km
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={onStart}
        className="rounded bg-orange-600 px-4 py-2 font-medium text-white"
      >
        Find my targets
      </button>
    </div>
  );
}

function TargetsMini({ crawl }: { crawl: ReturnType<typeof useCrawl> }) {
  return (
    <table className="mt-3 w-full text-sm">
      <thead className="text-left text-gray-500">
        <tr>
          <th className="py-1 font-normal">Segment</th>
          <th className="font-normal">Athletes</th>
          <th className="font-normal">Record</th>
          <th className="font-normal">Predicted</th>
        </tr>
      </thead>
      <tbody>
        {crawl.targets.map((s) => (
          <tr key={s.name} className="border-t border-gray-200">
            <td className="py-1">{s.name}</td>
            <td>{s.athletes.toLocaleString()}</td>
            <td>{t(s.record)}</td>
            <td>{t(s.predicted)}</td>
          </tr>
        ))}
        {crawl.targets.length === 0 && (
          <tr>
            <td colSpan={4} className="py-2 text-gray-500">
              Nothing yet…
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-gray-700">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-orange-600 border-t-transparent" />
      {text}
    </p>
  );
}

// ─── A: wizard ──────────────────────────────────────────────────────────────

function BenchmarkTable({
  rows,
  pin,
}: {
  rows: Row[];
  pin: (id: DistanceId, s: number | null) => void;
}) {
  return (
    <table className="mt-4 w-full max-w-xl text-sm">
      <thead className="text-left text-gray-500">
        <tr>
          <th className="py-1 font-normal">Distance</th>
          <th className="font-normal">Your Benchmark</th>
          <th className="font-normal" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id + String(r.pinned) + String(r.generated)}
            className="border-t border-gray-200"
          >
            <td className="py-2 font-medium">{label(r.id)}</td>
            <td>
              <TimeInput
                value={effective(r)}
                onCommit={(s) => pin(r.id, s === r.generated ? null : s)}
                className={r.pinned !== null ? 'border-orange-500 bg-orange-50' : ''}
              />
            </td>
            <td className="text-gray-600">
              {r.pinned !== null && r.generated !== null && (
                <>
                  📌 yours · generated {t(r.generated)}{' '}
                  <button
                    type="button"
                    onClick={() => pin(r.id, null)}
                    className="text-orange-700 underline"
                  >
                    use generated
                  </button>
                </>
              )}
              {r.pinned !== null && r.generated === null && '📌 yours'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VariantA({ stage, scenario }: { stage: Stage; scenario: Scenario }) {
  const gen = generate(scenario);
  const { pins, pin } = usePins();
  const rows = rowsFor(gen.vdot, pins);
  const [step, setStep] = useState(1);
  const generated = useFakeDelay(1800, scenario + stage);
  const crawl = useCrawl(step === 3);
  const entered = rows.filter((r) => effective(r) !== null).length;

  if (stage === 'returning')
    return (
      <>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Fitness Profile</h1>
          <button type="button" className="rounded border border-gray-300 px-3 py-1 text-sm">
            Regenerate from Strava
          </button>
        </div>
        <div className="mt-2">
          <Sources gen={gen} />
        </div>
        <BenchmarkTable rows={rows} pin={pin} />
      </>
    );

  const steps = ['Your fitness', 'Where you run', 'Your targets'];
  return (
    <>
      <ol className="mb-6 flex gap-2 text-sm">
        {steps.map((s, i) => (
          <li
            key={s}
            className={`flex-1 rounded border-b-4 px-2 py-1 ${i + 1 === step ? 'border-orange-600 font-semibold' : i + 1 < step ? 'border-orange-300 text-gray-600' : 'border-gray-200 text-gray-400'}`}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <>
          <h1 className="text-2xl font-bold">Here’s how fast we think you are</h1>
          {!generated ? (
            <div className="mt-6">
              <Spinner text="Reading your runs from the last 3 years…" />
            </div>
          ) : (
            <>
              <div className="mt-2">
                <Sources gen={gen} />
              </div>
              <BenchmarkTable rows={rows} pin={pin} />
              <button
                type="button"
                disabled={entered < 2}
                onClick={() => setStep(2)}
                className="mt-4 rounded bg-orange-600 px-4 py-2 font-medium text-white disabled:opacity-50"
              >
                Looks right, continue
              </button>
              {entered < 2 && (
                <span className="ml-3 text-sm text-gray-600">Enter at least two times.</span>
              )}
            </>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="mb-4 text-2xl font-bold">Where do you run?</h1>
          <SearchAreaStub onStart={() => setStep(3)} />
        </>
      )}

      {step === 3 && (
        <>
          <h1 className="text-2xl font-bold">
            {crawl.done ? 'Your targets are ready' : 'Finding your targets…'}
          </h1>
          <div className="mt-4 h-2 w-full overflow-hidden rounded bg-gray-200">
            <div
              className="h-full bg-orange-600 transition-all"
              style={{ width: `${(crawl.checked / crawl.total) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-gray-600">
            {crawl.checked} of ~{crawl.total} runs checked · {crawl.segmentsFound} Segments found.
            You can leave; this keeps going.
          </p>
          <TargetsMini crawl={crawl} />
          {crawl.done && (
            <button
              type="button"
              className="mt-4 rounded bg-orange-600 px-4 py-2 font-medium text-white"
            >
              See all results
            </button>
          )}
        </>
      )}
    </>
  );
}

// ─── B: straight to results, profile adjusted from a drawer ────────────────

function OverrideList({
  rows,
  pin,
}: {
  rows: Row[];
  pin: (id: DistanceId, s: number | null) => void;
}) {
  const [editing, setEditing] = useState<DistanceId | null>(null);
  return (
    <ul className="divide-y divide-gray-200">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 py-2">
          <span className="w-20 font-medium">{label(r.id)}</span>
          {editing === r.id || (r.generated === null && r.pinned === null) ? (
            <TimeInput
              value={effective(r)}
              onCommit={(s) => {
                pin(r.id, s);
                setEditing(null);
              }}
            />
          ) : (
            <span
              className={`w-24 tabular-nums ${r.pinned !== null ? 'font-semibold text-orange-800' : ''}`}
            >
              {t(effective(r))}
            </span>
          )}
          <span className="ml-auto text-sm text-gray-600">
            {r.pinned !== null && r.generated !== null ? (
              <>
                yours (estimate {t(r.generated)}) ·{' '}
                <button
                  type="button"
                  onClick={() => pin(r.id, null)}
                  className="text-orange-700 underline"
                >
                  reset
                </button>
              </>
            ) : r.generated !== null ? (
              <button
                type="button"
                onClick={() => setEditing(r.id)}
                className="text-orange-700 underline"
              >
                I’m faster/slower
              </button>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function VariantB({ stage, scenario }: { stage: Stage; scenario: Scenario }) {
  const gen = generate(scenario);
  const { pins, pin } = usePins();
  const rows = rowsFor(gen.vdot, pins);
  const [hasArea, setHasArea] = useState(stage === 'returning');
  const [drawer, setDrawer] = useState(false);
  const crawl = useCrawl(hasArea && stage === 'first');
  const entered = rows.filter((r) => effective(r) !== null).length;

  if (!hasArea)
    return (
      <div className="mx-auto max-w-md pt-8">
        <h1 className="text-2xl font-bold">Where do you run?</h1>
        <p className="mb-4 mt-1 text-gray-700">
          We’ll check your runs there for records you could take.
        </p>
        <SearchAreaStub onStart={() => setHasArea(true)} />
      </div>
    );

  const done = stage === 'returning' || crawl.done;
  return (
    <>
      <div
        className={`rounded border p-3 text-sm ${gen.vdot === null && entered < 2 ? 'border-red-300 bg-red-50' : 'border-orange-200 bg-orange-50'}`}
      >
        {gen.vdot === null && entered < 2 ? (
          <>
            We couldn’t estimate your fitness from Strava. Add two Benchmarks to see Predicted
            Times.{' '}
          </>
        ) : (
          <>
            Predictions use your fitness estimated from{' '}
            {gen.scoring.map((r) => r.name).join(' and ') || 'your own times'}
            {Object.keys(pins).length > 0 && ` (${Object.keys(pins).length} adjusted by you)`}.{' '}
          </>
        )}
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="font-medium text-orange-700 underline"
        >
          Adjust
        </button>
      </div>

      <div className="mt-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Your targets</h1>
        <span className="text-sm text-gray-600">High Park · 5 km</span>
      </div>
      {!done && (
        <p className="mt-1 text-sm text-gray-600">
          Still checking your runs: {crawl.checked} of ~{crawl.total}…
        </p>
      )}
      <TargetsMini
        crawl={stage === 'returning' ? { ...crawl, targets: TARGETS.slice(0, 4) } : crawl}
      />

      {drawer && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/30"
          onClick={() => setDrawer(false)}
        >
          <aside
            className="h-full w-full max-w-sm overflow-y-auto bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Your fitness</h2>
              <button type="button" onClick={() => setDrawer(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <p className="mb-3 mt-1 text-sm text-gray-600">Results update as you change a time.</p>
            <OverrideList rows={rows} pin={pin} />
          </aside>
        </div>
      )}
    </>
  );
}

// ─── C: checklist on first run, evidence-first profile page ────────────────

function EvidenceProfile({ scenario }: { scenario: Scenario }) {
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [shift, setShift] = useState(0);
  const { pins, pin } = usePins();
  const gen = generate(scenario, excluded);
  const vdot = gen.vdot === null ? null : gen.vdot + shift;
  const rows = rowsFor(vdot, pins);
  const [editing, setEditing] = useState<DistanceId | null>(null);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-semibold">Fitness level</h2>
        {vdot === null ? (
          <p className="text-sm text-gray-700">
            No race-like runs found. Type your own times below.
          </p>
        ) : (
          <div className="mt-1 flex items-center gap-3">
            <input
              type="range"
              min={-6}
              max={6}
              step={0.5}
              value={shift}
              onChange={(e) => setShift(Number(e.target.value))}
              className="w-64"
            />
            <span className="text-sm">
              {shift === 0
                ? 'As estimated'
                : shift > 0
                  ? `${shift} fitter than estimated`
                  : `${-shift} less fit than estimated`}{' '}
              <span className="text-gray-500">(VDOT {vdot.toFixed(1)})</span>
            </span>
          </div>
        )}
      </section>

      {gen.runs.length + excluded.size > 0 && (
        <section>
          <h2 className="font-semibold">Based on these runs</h2>
          <p className="text-sm text-gray-600">
            Your fastest whole run near each distance, last 3 years. The two best score your
            fitness.
          </p>
          <ul className="mt-2 divide-y divide-gray-200 text-sm">
            {generate(scenario).runs.map((r) => {
              const out = excluded.has(r.name);
              const scoring = gen.scoring.some((s) => s.name === r.name);
              return (
                <li
                  key={r.name}
                  className={`flex items-center gap-3 py-1.5 ${out ? 'text-gray-400 line-through' : ''}`}
                >
                  <span className="w-5">{scoring ? '★' : ''}</span>
                  <span className="flex-1">
                    {r.name}{' '}
                    <span className="text-gray-500">
                      · {label(r.distance)} · {r.date}
                    </span>
                  </span>
                  <span className="w-20 tabular-nums">{t(r.movingSeconds)}</span>
                  <span className="w-16 text-gray-500">{r.vdot.toFixed(1)}</span>
                  <button
                    type="button"
                    className="w-20 whitespace-nowrap text-right text-orange-700 underline"
                    onClick={() =>
                      setExcluded((s) => {
                        const n = new Set(s);
                        if (n.has(r.name)) n.delete(r.name);
                        else n.add(r.name);
                        return n;
                      })
                    }
                  >
                    {out ? 'include' : 'not a race'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-semibold">Benchmarks</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {rows.map((r) => (
            <div
              key={r.id}
              className={`rounded border p-2 ${r.pinned !== null ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}
            >
              <div className="text-xs text-gray-500">
                {label(r.id)} {r.pinned !== null && '📌'}
              </div>
              {editing === r.id ? (
                <TimeInput
                  value={effective(r)}
                  onCommit={(s) => {
                    pin(r.id, s);
                    setEditing(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(r.id)}
                  className="text-lg font-semibold tabular-nums"
                >
                  {t(effective(r))}
                </button>
              )}
              {r.pinned !== null && r.generated !== null && (
                <button
                  type="button"
                  onClick={() => pin(r.id, null)}
                  className="block text-xs text-orange-700 underline"
                >
                  use {t(r.generated)}
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Click a time to set your own. Pinned times ignore the slider and regeneration.
        </p>
      </section>
    </div>
  );
}

export function VariantC({ stage, scenario }: { stage: Stage; scenario: Scenario }) {
  const gen = generate(scenario);
  const [open, setOpen] = useState<number | null>(stage === 'first' ? null : 0);
  const [areaSet, setAreaSet] = useState(false);
  const crawl = useCrawl(areaSet);
  const generated = useFakeDelay(1500, scenario + stage);

  if (stage === 'returning')
    return (
      <>
        <h1 className="mb-4 text-2xl font-bold">Fitness Profile</h1>
        <EvidenceProfile scenario={scenario} />
      </>
    );

  const items = [
    {
      title: 'Check your Fitness Profile',
      status: !generated
        ? 'Estimating…'
        : gen.vdot === null
          ? 'Needs your times'
          : `Estimated from ${gen.scoring.length} run${gen.scoring.length > 1 ? 's' : ''}`,
      done: generated && gen.vdot !== null,
      body: generated ? (
        <EvidenceProfile scenario={scenario} />
      ) : (
        <Spinner text="Reading your runs…" />
      ),
    },
    {
      title: 'Pick where you run',
      status: areaSet ? 'High Park · 5 km' : 'Not set',
      done: areaSet,
      body: (
        <SearchAreaStub
          onStart={() => {
            setAreaSet(true);
            setOpen(2);
          }}
        />
      ),
    },
    {
      title: 'Your first targets',
      status: !areaSet
        ? 'Waiting for a Search Area'
        : crawl.done
          ? `${crawl.targets.length} found`
          : `${crawl.checked} of ~${crawl.total} runs checked`,
      done: crawl.done,
      body: <TargetsMini crawl={crawl} />,
    },
  ];

  return (
    <>
      <h1 className="text-2xl font-bold">Welcome to myKOM</h1>
      <p className="mt-1 text-gray-700">
        Three things to get going, in any order. Nothing here blocks the rest.
      </p>
      <ul className="mt-4 divide-y divide-gray-200 rounded border border-gray-200">
        {items.map((it, i) => (
          <li key={it.title}>
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center gap-3 p-3 text-left"
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-sm ${it.done ? 'bg-green-600 text-white' : 'border border-gray-400'}`}
              >
                {it.done ? '✓' : i + 1}
              </span>
              <span className="flex-1 font-medium">{it.title}</span>
              <span className="text-sm text-gray-600">{it.status}</span>
            </button>
            {open === i && <div className="border-t border-gray-100 p-3">{it.body}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
