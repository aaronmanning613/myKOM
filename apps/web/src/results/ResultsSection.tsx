// One results list as a table (Your targets, Nearest misses or Suspicious records), following
// the decided variant A of the results-list prototype. Never shows a record holder's identity.
import {
  formatTime,
  LOW_CONFIDENCE_MAX_GRADE,
  type PredictionReason,
  type ResultRow,
  stravaSegmentUrl,
} from '@mykom/shared';
import type { ReactNode } from 'react';
import { showMoreLabel, visibleRows } from './paging';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Records read longer ago than this show their age. */
export const RECORD_AGE_SHOWN_AFTER_DAYS = 30;

/** "820 m" or "1.61 km". */
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(2)} km`;
}

/** A grade given as a fraction, as a percentage with one decimal: "3.2%". */
export function formatGrade(fraction: number): string {
  const percent = Math.round(fraction * 1000) / 10;
  return `${Object.is(percent, -0) ? 0 : percent.toFixed(1)}%`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "record checked 5 weeks ago" once the record is over 30 days old, otherwise null. */
export function recordAge(checkedAt: string, now: Date): string | null {
  const days = Math.floor((now.getTime() - Date.parse(checkedAt)) / DAY_MS);
  if (!(days > RECORD_AGE_SHOWN_AFTER_DAYS)) return null;
  const age =
    days < 60
      ? plural(Math.floor(days / 7), 'week')
      : days < 365
        ? plural(Math.floor(days / 30), 'month')
        : plural(Math.floor(days / 365), 'year');
  return `record checked ${age} ago`;
}

/** Why a Predicted Time is low confidence, for the `~` hover. */
const LOW_CONFIDENCE_REASONS: Partial<Record<PredictionReason, string>> = {
  'outside-benchmark-range': 'Rough guess: outside the range of your Benchmarks',
  steep: `Rough guess: steeper than ${Math.round(LOW_CONFIDENCE_MAX_GRADE * 100)}% in places`,
  rolling: 'Rough guess: rolling, with more climbing than its average grade shows',
};

export function Predicted({ predicted }: { predicted: ResultRow['predicted'] }) {
  if (!predicted) return <>—</>;
  const time = formatTime(Math.round(predicted.seconds));
  if (predicted.confidence === 'high') return <>{time}</>;
  return (
    <span
      className="cursor-help underline decoration-gray-400 decoration-dotted"
      title={LOW_CONFIDENCE_REASONS[predicted.reason] ?? 'Rough guess'}
    >
      ~{time}
    </span>
  );
}

/**
 * "View on Strava", the wording Strava's brand guidelines ask for, in Strava orange. The colour
 * is `!important` so Leaflet's `.leaflet-container a` blue doesn't win inside map popups.
 */
export function StravaLink({ segmentId, name }: { segmentId: number; name: string }) {
  return (
    <a
      href={stravaSegmentUrl(segmentId)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View ${name} on Strava`}
      className="font-bold text-[#FC5200]! underline"
    >
      View on Strava
    </a>
  );
}

function Row({
  row,
  now,
  onShowOnMap,
}: {
  row: ResultRow;
  now: Date;
  onShowOnMap?: (segmentId: number) => void;
}) {
  const age = recordAge(row.recordCheckedAt, now);
  return (
    <tr className="border-b border-gray-100 align-top">
      <td className="py-2 pr-2">
        <div className="font-medium break-words">
          {row.held && (
            <span
              role="img"
              aria-label="Held"
              title="Held: your Segment PB is at or under the Target Record"
              className="mr-1"
            >
              👑
            </span>
          )}
          {row.name}
          {row.implausible && (
            <span
              className="ml-1 inline-block rounded bg-red-100 px-1 py-0.5 sm:px-1.5 text-xs font-medium whitespace-nowrap text-red-800"
              title="Faster than is humanly plausible: probably a GPS glitch or a ride"
            >
              ⚠ Suspicious
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500">
          {formatDistance(row.distance)} · {formatGrade(row.averageGrade)} ·{' '}
          {row.kmFromCentre.toFixed(1)} km away
        </div>
        {age && <div className="text-xs text-gray-500">{age}</div>}
        <div className="flex flex-wrap gap-x-3 text-xs">
          <StravaLink segmentId={row.segmentId} name={row.name} />
          {onShowOnMap && (
            <button
              type="button"
              aria-label={`Show ${row.name} on map`}
              onClick={() => onShowOnMap(row.segmentId)}
              className="text-left font-medium text-gray-700 underline"
            >
              Show on map
            </button>
          )}
        </div>
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">
        {row.athleteCount.toLocaleString('en-US')}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">{formatTime(row.record)}</td>
      <td className="py-2 pr-2 text-right whitespace-nowrap tabular-nums">
        <Predicted predicted={row.predicted} />
      </td>
      <td className="py-2 text-right text-gray-600 tabular-nums">
        {row.pb === null ? '—' : formatTime(row.pb)}
      </td>
    </tr>
  );
}

export function ResultsSection({
  title,
  subtitle,
  rows,
  now,
  empty,
  muted = false,
  onShowOnMap,
  shown,
  onShowMore,
}: {
  title: string;
  subtitle?: string;
  rows: ResultRow[];
  now: Date;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
  muted?: boolean;
  /** Gives each row a "Show on map" button (only where there's a map). */
  onShowOnMap?: (segmentId: number) => void;
  /** With `onShowMore`, pages the list: only the first `shown` rows, then "Show N more". */
  shown?: number;
  onShowMore?: () => void;
}) {
  const id = `results-${title.toLowerCase().replaceAll(' ', '-')}`;
  const paged = shown !== undefined && onShowMore !== undefined;
  const visible = paged ? visibleRows(rows, shown) : rows;
  const more = paged ? showMoreLabel(rows.length, visible.length) : null;
  return (
    <section aria-labelledby={id} className={`mt-6 ${muted ? 'opacity-70' : ''}`}>
      <h2 id={id} className="text-lg font-semibold">
        {title} <span className="text-sm font-normal text-gray-500">({rows.length})</span>
      </h2>
      {subtitle && <p className="text-sm text-gray-600">{subtitle}</p>}
      {rows.length === 0 ? (
        empty
      ) : (
        <div className="mt-2 overflow-x-auto">
          {/* Fixed column widths from sm up, so the three sections line up. */}
          <table className="w-full text-sm sm:table-fixed">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500 uppercase">
                <th className="py-1 pr-2">Segment</th>
                <th className="py-1 pr-2 text-right sm:w-24">Athletes</th>
                <th className="py-1 pr-2 text-right sm:w-24">Record</th>
                <th className="py-1 pr-2 text-right sm:w-24">Predicted</th>
                <th className="py-1 text-right sm:w-24">Your PB</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <Row key={row.segmentId} row={row} now={now} onShowOnMap={onShowOnMap} />
              ))}
            </tbody>
          </table>
          {more && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-gray-600">{more.status}</span>
              <button
                type="button"
                aria-label={`${more.button} ${title}`}
                onClick={onShowMore}
                className="rounded border border-gray-300 px-3 py-1 font-medium text-gray-800 hover:bg-gray-50"
              >
                {more.button}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
