export type ParseTimeResult = { ok: true; seconds: number } | { ok: false; error: string };

const FORMAT_ERROR = 'Enter a time like 75, 3:42 or 1:05:10';

/**
 * Parses a Runner-entered time into whole seconds. Accepts `ss` (any number of
 * seconds), `m:ss` (any number of minutes) and `h:mm:ss`, with leading zeros
 * allowed. Fields after a colon must be exactly two digits and under 60.
 * Surrounding whitespace is ignored.
 */
export function parseTime(input: string): ParseTimeResult {
  const text = input.trim();
  if (text === '') return { ok: false, error: 'Enter a time' };

  const [first, ...rest] = text.split(':') as [string, ...string[]];
  if (rest.length > 2 || !/^\d+$/.test(first) || rest.some((part) => !/^\d{2}$/.test(part))) {
    return { ok: false, error: FORMAT_ERROR };
  }
  if (rest.some((part) => Number(part) >= 60)) {
    return { ok: false, error: 'Minutes and seconds must be under 60' };
  }

  const seconds = [first, ...rest].reduce((total, part) => total * 60 + Number(part), 0);
  if (seconds === 0) return { ok: false, error: 'Time must be more than zero' };

  return { ok: true, seconds };
}

/** Formats whole seconds as `m:ss`, or `h:mm:ss` from one hour up. */
export function formatTime(totalSeconds: number): string {
  if (!Number.isInteger(totalSeconds) || totalSeconds < 0) {
    throw new RangeError(`Expected a whole, non-negative number of seconds, got ${totalSeconds}`);
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours === 0) return `${minutes}:${ss}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
}

/** Seconds per kilometre for a time over a distance. */
export function pacePerKm(seconds: number, metres: number): number {
  if (!(seconds > 0) || !(metres > 0)) {
    throw new RangeError('Time and distance must both be more than zero');
  }
  return (seconds / metres) * 1000;
}

/** Formats a pace in seconds per kilometre as `m:ss/km`, to the nearest second. */
export function formatPace(secondsPerKm: number): string {
  return `${formatTime(Math.round(secondsPerKm))}/km`;
}
