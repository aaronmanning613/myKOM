// PROTOTYPE, throwaway: three structurally different Results page layouts (wayfinder #19).
// A: dense table with a toolbar. B: gap-bar cards with sections as tabs. C: sentence controls and
// a compact expandable leaderboard.
import { SEARCH_RADII_KM, formatTime, type SearchRadiusKm } from '@mykom/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  MARGIN_PRESETS,
  PROTO_AREA_LABEL,
  formatDistance,
  formatGrade,
  gapLabel,
  type Margin,
  type Results,
  type Row,
} from './data';

export type VariantProps = {
  results: Results;
  margin: Margin;
  setMargin: (m: Margin) => void;
  radiusKm: SearchRadiusKm;
  setRadiusKm: (r: SearchRadiusKm) => void;
};

function Crown() {
  return (
    <span title="Held: your Segment PB is at or under the Target Record" aria-label="Held">
      👑
    </span>
  );
}

function ImplausibleFlag({ short }: { short?: boolean }) {
  return (
    <span
      className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800"
      title="Faster than 1.05 × a grade-adjusted world record: probably GPS error"
    >
      ⚠ {short ? 'Suspicious' : 'Suspicious record'}
    </span>
  );
}

function LowConfidence({ reason }: { reason: string }) {
  return (
    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600" title={reason}>
      ≈ rough guess
    </span>
  );
}

function gapClass(row: Row) {
  if (row.gapRatio <= 1) return 'text-green-700';
  return row.achievable ? 'text-amber-700' : 'text-red-700';
}

function emptyMain() {
  return (
    <p className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-600">
      No Segments in this Search Area are within your margin yet. Try a wider margin, a bigger
      radius, or look at the Nearest misses below.
    </p>
  );
}

// ─── A: Table ────────────────────────────────────────────────────────────────────────────────

export function VariantA({ results, radiusKm, setRadiusKm }: VariantProps) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Results</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <span className="text-gray-600">Within</span>
            <select
              className="rounded border border-gray-300 px-2 py-1"
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value) as SearchRadiusKm)}
            >
              {SEARCH_RADII_KM.map((r) => (
                <option key={r} value={r}>
                  {r} km
                </option>
              ))}
            </select>
          </label>
          <span className="text-gray-600">
            of{' '}
            <Link to="/search-area" className="font-medium text-orange-700 underline">
              {PROTO_AREA_LABEL}
            </Link>
          </span>
        </div>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        {results.achievableCount} of {results.inAreaCount} Known Segments are Achievable.
      </p>

      <TableSection title="Your targets" rows={results.main} empty={emptyMain()} />
      {results.nearestMisses.length > 0 && (
        <TableSection
          title="Nearest misses"
          subtitle="Not quite in reach yet: the closest to the record."
          rows={results.nearestMisses}
        />
      )}
      {results.suspicious.length > 0 && (
        <TableSection
          title="Suspicious records"
          subtitle="Records faster than is humanly plausible: probably GPS glitches."
          rows={results.suspicious}
          muted
        />
      )}
    </>
  );
}

function TableSection({
  title,
  subtitle,
  rows,
  empty,
  muted,
}: {
  title: string;
  subtitle?: string;
  rows: Row[];
  empty?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">
        {title} <span className="text-sm font-normal text-gray-500">({rows.length})</span>
      </h2>
      {subtitle && <p className="text-sm text-gray-600">{subtitle}</p>}
      {rows.length === 0 && empty}
      {rows.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className={`w-full text-sm ${muted ? 'opacity-70' : ''}`}>
            <thead>
              <tr className="border-b text-left text-xs text-gray-500 uppercase">
                <th className="py-1 pr-2">Segment</th>
                <th className="py-1 pr-2 text-right">Athletes</th>
                <th className="py-1 pr-2 text-right">Record</th>
                <th className="py-1 pr-2 text-right">Predicted</th>
                <th className="py-1 text-right">Your PB</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-2">
                    <div className="flex flex-wrap items-center gap-1 font-medium">
                      {r.held && <Crown />}
                      {r.name}
                      {r.implausible && <ImplausibleFlag short />}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDistance(r.distanceM)} · {formatGrade(r.avgGrade)} · {r.kmFromCentre}{' '}
                      km away
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {r.athleteCount.toLocaleString()}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {formatTime(r.targetRecordS)}
                  </td>
                  <td
                    className="py-2 pr-2 text-right tabular-nums"
                    title={r.lowConfidenceReason ?? undefined}
                  >
                    {r.lowConfidence && '~'}
                    {formatTime(r.predictedS)}
                  </td>
                  <td className="py-2 text-right text-gray-600 tabular-nums">
                    {r.pbS === null ? '—' : formatTime(r.pbS)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── B: Gap-bar cards, sections as tabs ─────────────────────────────────────────────────────

type Tab = 'main' | 'misses' | 'suspicious';

export function VariantB({ results, margin, setMargin, radiusKm, setRadiusKm }: VariantProps) {
  const [tab, setTab] = useState<Tab>('main');
  const tabs: { key: Tab; label: string; rows: Row[]; hidden?: boolean }[] = [
    { key: 'main', label: 'Targets', rows: results.main },
    {
      key: 'misses',
      label: 'Nearest misses',
      rows: results.nearestMisses,
      hidden: results.nearestMisses.length === 0,
    },
    { key: 'suspicious', label: 'Suspicious', rows: results.suspicious },
  ];
  const active = tabs.find((t) => t.key === tab && !t.hidden) ?? tabs[0]!;

  return (
    <div className="grid gap-6 md:grid-cols-[12rem_1fr]">
      <aside className="space-y-5 md:sticky md:top-4 md:self-start">
        <h1 className="text-2xl font-bold">Results</h1>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase">Search Area</p>
          <p className="mt-1 text-sm font-medium">{PROTO_AREA_LABEL}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {SEARCH_RADII_KM.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRadiusKm(r)}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  r === radiusKm ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {r} km
              </button>
            ))}
          </div>
          <Link to="/search-area" className="mt-2 inline-block text-xs text-orange-700 underline">
            Change place
          </Link>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase">Margin</p>
          <p className="mt-1 text-xs text-gray-600">
            Show Segments where you’re predicted within this much of the record.
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {MARGIN_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMargin(m)}
                className={`rounded px-2 py-1 text-xs ${
                  m === margin ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {m}%
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div>
        <div className="flex gap-1 border-b border-gray-200" role="tablist">
          {tabs
            .filter((t) => !t.hidden)
            .map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.key === active.key}
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  t.key === active.key
                    ? 'border-orange-600 font-semibold text-orange-800'
                    : 'border-transparent text-gray-600'
                }`}
              >
                {t.label} <span className="text-gray-400">{t.rows.length}</span>
              </button>
            ))}
        </div>
        {active.key === 'main' && results.nearestMisses.length > 0 && (
          <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-900">
            Only {results.achievableCount} Achievable here.{' '}
            <button type="button" className="underline" onClick={() => setTab('misses')}>
              See your {results.nearestMisses.length} nearest misses
            </button>
          </p>
        )}
        <div className="mt-3 space-y-3">
          {active.rows.length === 0 && active.key === 'main' && emptyMain()}
          {active.rows.map((r) => (
            <GapCard key={r.id} row={r} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A time axis with the record, the prediction and the PB as marks. */
function GapCard({ row }: { row: Row }) {
  const times = [row.targetRecordS, row.predictedS, ...(row.pbS === null ? [] : [row.pbS])];
  const lo = Math.min(...times) * 0.97;
  const hi = Math.max(...times) * 1.03;
  const pos = (t: number) => `${((t - lo) / (hi - lo)) * 100}%`;

  return (
    <article className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex flex-wrap items-center gap-1 font-semibold">
            {row.held && <Crown />}
            {row.name}
          </h3>
          <p className="text-xs text-gray-500">
            {formatDistance(row.distanceM)} · {formatGrade(row.avgGrade)} ·{' '}
            {row.athleteCount.toLocaleString()} athletes
          </p>
        </div>
        <div className={`text-right text-sm font-semibold ${gapClass(row)}`}>{gapLabel(row)}</div>
      </div>
      <div className="relative mt-4 mb-5 h-1.5 rounded bg-gray-100">
        <Mark
          at={pos(row.targetRecordS)}
          label={`Record ${formatTime(row.targetRecordS)}`}
          color="bg-orange-600"
          top
        />
        <Mark
          at={pos(row.predictedS)}
          label={`You ${row.lowConfidence ? '~' : ''}${formatTime(row.predictedS)}`}
          color={row.lowConfidence ? 'bg-gray-400' : 'bg-blue-600'}
          dashed={row.lowConfidence}
        />
        {row.pbS !== null && (
          <Mark at={pos(row.pbS)} label={`PB ${formatTime(row.pbS)}`} color="bg-gray-500" top />
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {row.implausible && <ImplausibleFlag />}
        {row.lowConfidence && <LowConfidence reason={row.lowConfidenceReason!} />}
      </div>
    </article>
  );
}

function Mark({
  at,
  label,
  color,
  top,
  dashed,
}: {
  at: string;
  label: string;
  color: string;
  top?: boolean;
  dashed?: boolean;
}) {
  return (
    <div className="absolute -translate-x-1/2" style={{ left: at, top: '-5px' }}>
      <div className={`h-4 w-1 rounded ${color} ${dashed ? 'opacity-60' : ''}`} />
      <div
        className={`absolute left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap text-gray-600 tabular-nums ${
          top ? '-top-4' : 'top-4'
        }`}
      >
        {label}
      </div>
    </div>
  );
}

// ─── C: Sentence controls, compact expandable leaderboard ────────────────────────────────────

export function VariantC({ results, margin, setMargin, radiusKm, setRadiusKm }: VariantProps) {
  const inline = 'mx-1 rounded border-b-2 border-orange-500 bg-orange-50 px-1 font-semibold';
  return (
    <>
      <p className="text-lg leading-relaxed">
        Segments within
        <select
          className={inline}
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value) as SearchRadiusKm)}
        >
          {SEARCH_RADII_KM.map((r) => (
            <option key={r} value={r}>
              {r} km
            </option>
          ))}
        </select>
        of
        <Link to="/search-area" className={inline}>
          {PROTO_AREA_LABEL}
        </Link>
        where you’re predicted within
        <select
          className={inline}
          value={margin}
          onChange={(e) => setMargin(Number(e.target.value) as Margin)}
        >
          {MARGIN_PRESETS.map((m) => (
            <option key={m} value={m}>
              {m}%
            </option>
          ))}
        </select>
        of the record.
      </p>

      <h2 className="mt-6 text-sm font-semibold text-gray-500 uppercase">
        {results.main.length} targets
      </h2>
      {results.main.length === 0 ? emptyMain() : <Leaderboard rows={results.main} numbered />}

      {results.nearestMisses.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-gray-500 uppercase">
            Nearest misses: train for these
          </h2>
          <Leaderboard rows={results.nearestMisses} />
        </>
      )}

      {results.suspicious.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-semibold text-gray-500 uppercase">
            {results.suspicious.length} suspicious records hidden
          </summary>
          <Leaderboard rows={results.suspicious} />
        </details>
      )}
    </>
  );
}

function Leaderboard({ rows, numbered }: { rows: Row[]; numbered?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ol className="mt-2 divide-y divide-gray-100 rounded border border-gray-200">
      {rows.map((r, i) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => setOpen(open === r.id ? null : r.id)}
            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50"
          >
            {numbered && <span className="w-5 text-sm text-gray-400 tabular-nums">{i + 1}</span>}
            <span className="w-6 text-center">{r.held ? '👑' : ''}</span>
            <span className="flex-1 truncate font-medium">
              {r.name}
              {r.implausible && <span className="ml-1 text-red-600">⚠</span>}
              {r.lowConfidence && <span className="ml-1 text-gray-400">≈</span>}
            </span>
            <span className="hidden text-xs text-gray-500 tabular-nums sm:inline">
              {r.athleteCount.toLocaleString()}
            </span>
            <span className={`w-36 text-right text-sm font-semibold ${gapClass(r)}`}>
              {gapLabel(r)}
            </span>
          </button>
          {open === r.id && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 bg-gray-50 px-12 py-3 text-sm sm:grid-cols-3">
              <Detail term="Distance" value={formatDistance(r.distanceM)} />
              <Detail term="Grade" value={formatGrade(r.avgGrade)} />
              <Detail term="Athletes" value={r.athleteCount.toLocaleString()} />
              <Detail term="Record" value={formatTime(r.targetRecordS)} />
              <Detail
                term="Predicted"
                value={`${r.lowConfidence ? '~' : ''}${formatTime(r.predictedS)}`}
              />
              <Detail term="Your PB" value={r.pbS === null ? 'not run yet' : formatTime(r.pbS)} />
              {(r.implausible || r.lowConfidence) && (
                <div className="col-span-full mt-1 flex flex-wrap gap-1">
                  {r.implausible && <ImplausibleFlag />}
                  {r.lowConfidence && <LowConfidence reason={r.lowConfidenceReason!} />}
                  {r.lowConfidence && (
                    <span className="text-xs text-gray-500">{r.lowConfidenceReason}</span>
                  )}
                </div>
              )}
            </dl>
          )}
        </li>
      ))}
    </ol>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{term}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
