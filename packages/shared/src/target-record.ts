/** Which record the Runner is ranked against: the KOM (men) or the QOM (women). */
export type RecordGender = 'KOM' | 'QOM';

/** Why a Segment has no Target Record for a gender (the non-`ok` `segments.record_status` values). */
export type NoRecordStatus = 'hazardous' | 'missing' | 'unparseable';

export type ParsedXoms = { status: 'ok'; seconds: number } | { status: 'unparseable' };

export type TargetRecord = { status: 'ok'; seconds: number } | { status: NoRecordStatus };

/** The parts of a Segment's detail that decide its Target Record. */
export type RecordSource = {
  hazardous: boolean;
  /** Strava's display strings from `xoms` on `GET /segments/{id}`; null when absent. */
  xoms: { kom?: string | null; qom?: string | null } | null;
};

const SECONDS_ONLY = /^(\d+)s$/;
const CLOCK = /^(?:(\d+):)?(\d+):(\d{2})$/;

/**
 * Parses one `xoms` display string into whole seconds. Strava shows records as
 * `"17s"` under a minute, `"1:24"` (m:ss) and `"1:02:03"` (h:mm:ss). Anything
 * else, including a zero time, is `unparseable`.
 */
export function parseXoms(raw: string): ParsedXoms {
  const text = raw.trim();

  const secondsOnly = SECONDS_ONLY.exec(text);
  if (secondsOnly) return ok(Number(secondsOnly[1]));

  const clock = CLOCK.exec(text);
  if (!clock) return { status: 'unparseable' };
  const [, hours, minutes = '', seconds = ''] = clock;
  if (Number(seconds) >= 60) return { status: 'unparseable' };
  // With an hours field, minutes must be two digits and under 60 too.
  if (hours !== undefined && (minutes.length !== 2 || Number(minutes) >= 60)) {
    return { status: 'unparseable' };
  }
  return ok(Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds));
}

function ok(seconds: number): ParsedXoms {
  return seconds > 0 ? { status: 'ok', seconds } : { status: 'unparseable' };
}

/**
 * The Segment's Target Record for a gender: seconds, or why there isn't one.
 * A hazardous Segment has no record whatever `xoms` says.
 */
export function recordFor(segment: RecordSource, gender: RecordGender): TargetRecord {
  if (segment.hazardous) return { status: 'hazardous' };
  const raw = gender === 'KOM' ? segment.xoms?.kom : segment.xoms?.qom;
  // TODO(decision): an empty or blank string is treated as `missing`, not `unparseable`.
  if (raw == null || raw.trim() === '') return { status: 'missing' };
  return parseXoms(raw);
}

/**
 * A Held Segment: the Segment PB is at or under the Target Record in whole
 * seconds (ties count). With no Segment PB, the Segment is not Held.
 */
export function isHeld(pb: number | null | undefined, record: number): boolean {
  if (pb == null) return false;
  return Math.round(pb) <= Math.round(record);
}
