// PROTOTYPE, throwaway: fixture Segments plus the Ranking rules (wayfinder #11) computed in memory,
// so the Results page variants have something realistic to render. Nothing here hits the API.
import type { SearchRadiusKm } from '@mykom/shared';

export const MARGIN_PRESETS = [0, 3, 5, 10, 15, 20] as const;
export type Margin = (typeof MARGIN_PRESETS)[number];

export type Runner = 'fast' | 'slow';

export type ProtoSegment = {
  id: number;
  name: string;
  distanceM: number;
  /** Average grade, percent. */
  avgGrade: number;
  /** Impressiveness. */
  athleteCount: number;
  targetRecordS: number;
  /** Predicted Time for the fast fixture Runner; the slow one is scaled. */
  predictedS: number;
  /** Segment PB for the fast fixture Runner, or null if never recorded (starred only). */
  pbS: number | null;
  lowConfidenceReason: string | null;
  implausible: boolean;
  /** From the Search Area centre. */
  kmFromCentre: number;
};

// Invented Bristol-ish Segments covering every case the row has to show.
const SEGMENTS: ProtoSegment[] = [
  {
    id: 101,
    name: 'Harbourside Dash',
    distanceM: 820,
    avgGrade: 0.2,
    athleteCount: 18432,
    targetRecordS: 141,
    predictedS: 146,
    pbS: 152,
    lowConfidenceReason: null,
    implausible: false,
    kmFromCentre: 0.6,
  },
  {
    id: 102,
    name: 'Park Street Drag',
    distanceM: 450,
    avgGrade: 7.8,
    athleteCount: 12210,
    targetRecordS: 98,
    predictedS: 101,
    pbS: 97,
    lowConfidenceReason: null,
    implausible: false,
    kmFromCentre: 1.1,
  },
  {
    id: 103,
    name: 'Downs Loop (full)',
    distanceM: 3950,
    avgGrade: 0.4,
    athleteCount: 9876,
    targetRecordS: 721,
    predictedS: 748,
    pbS: 781,
    lowConfidenceReason: null,
    implausible: false,
    kmFromCentre: 3.2,
  },
  {
    id: 104,
    name: 'Suspension Bridge crossing',
    distanceM: 410,
    avgGrade: 0.0,
    athleteCount: 22051,
    targetRecordS: 49,
    predictedS: 71,
    pbS: 74,
    lowConfidenceReason: null,
    implausible: true,
    kmFromCentre: 2.4,
  },
  {
    id: 105,
    name: 'Brandon Hill steps sprint',
    distanceM: 160,
    avgGrade: 14.5,
    athleteCount: 3120,
    targetRecordS: 38,
    predictedS: 37,
    pbS: 41,
    lowConfidenceReason: 'Under 400 m: sprints are outside the model’s tested range',
    implausible: false,
    kmFromCentre: 0.9,
  },
  {
    id: 106,
    name: 'Feeder Road flat mile',
    distanceM: 1609,
    avgGrade: -0.1,
    athleteCount: 6540,
    targetRecordS: 289,
    predictedS: 301,
    pbS: 318,
    lowConfidenceReason: null,
    implausible: false,
    kmFromCentre: 2.0,
  },
  {
    id: 107,
    name: 'Clifton Vale climb',
    distanceM: 690,
    avgGrade: 9.1,
    athleteCount: 4411,
    targetRecordS: 176,
    predictedS: 172,
    pbS: 169,
    lowConfidenceReason: null,
    implausible: false,
    kmFromCentre: 1.3,
  },
  {
    id: 108,
    name: 'Ashton Court avenue',
    distanceM: 1220,
    avgGrade: 2.6,
    athleteCount: 8021,
    targetRecordS: 236,
    predictedS: 262,
    pbS: 270,
    lowConfidenceReason: null,
    implausible: false,
    kmFromCentre: 4.5,
  },
  {
    id: 109,
    name: 'Snuff Mills trail',
    distanceM: 2100,
    avgGrade: 1.8,
    athleteCount: 2980,
    targetRecordS: 468,
    predictedS: 474,
    pbS: null,
    lowConfidenceReason: null,
    implausible: false,
    kmFromCentre: 7.2,
  },
  {
    id: 110,
    name: 'Troopers Hill descent',
    distanceM: 380,
    avgGrade: -11.2,
    athleteCount: 1544,
    targetRecordS: 58,
    predictedS: 61,
    pbS: 66,
    lowConfidenceReason: 'Under 400 m and steep downhill: grade near the model’s limit',
    implausible: false,
    kmFromCentre: 5.6,
  },
  {
    id: 111,
    name: 'Cheltenham Road kick',
    distanceM: 300,
    avgGrade: 1.0,
    athleteCount: 5402,
    targetRecordS: 29,
    predictedS: 55,
    pbS: 52,
    lowConfidenceReason: 'Under 400 m: sprints are outside the model’s tested range',
    implausible: true,
    kmFromCentre: 2.9,
  },
  {
    id: 112,
    name: 'Portway riverside 5k',
    distanceM: 5000,
    avgGrade: 0.1,
    athleteCount: 11890,
    targetRecordS: 968,
    predictedS: 1041,
    pbS: 1066,
    lowConfidenceReason: null,
    implausible: false,
    kmFromCentre: 6.1,
  },
  {
    id: 113,
    name: 'Blaise Castle hill',
    distanceM: 960,
    avgGrade: 6.4,
    athleteCount: 2240,
    targetRecordS: 247,
    predictedS: 249,
    pbS: 244,
    lowConfidenceReason: null,
    implausible: false,
    kmFromCentre: 8.4,
  },
  {
    id: 114,
    name: 'Keynsham Memorial Park lap',
    distanceM: 1400,
    avgGrade: 0.3,
    athleteCount: 1320,
    targetRecordS: 262,
    predictedS: 265,
    pbS: 279,
    lowConfidenceReason: null,
    implausible: false,
    kmFromCentre: 12.8,
  },
  {
    id: 115,
    name: 'Leigh Woods singletrack',
    distanceM: 1750,
    avgGrade: 3.2,
    athleteCount: 4899,
    targetRecordS: 402,
    predictedS: 431,
    pbS: 455,
    lowConfidenceReason: 'Only one Benchmark near this distance',
    implausible: false,
    kmFromCentre: 3.8,
  },
  {
    id: 116,
    name: 'Bath Two Tunnels',
    distanceM: 6200,
    avgGrade: 0.4,
    athleteCount: 30511,
    targetRecordS: 1190,
    predictedS: 1226,
    pbS: 1260,
    lowConfidenceReason: null,
    implausible: false,
    kmFromCentre: 18.5,
  },
  {
    id: 117,
    name: 'Weston seafront',
    distanceM: 3000,
    avgGrade: 0.0,
    athleteCount: 14602,
    targetRecordS: 431,
    predictedS: 575,
    pbS: null,
    lowConfidenceReason: null,
    implausible: true,
    kmFromCentre: 31.0,
  },
  {
    id: 118,
    name: 'Cotswold Way: Wotton climb',
    distanceM: 1800,
    avgGrade: 8.7,
    athleteCount: 2710,
    targetRecordS: 520,
    predictedS: 528,
    pbS: 536,
    lowConfidenceReason: null,
    implausible: false,
    kmFromCentre: 34.6,
  },
];

const SLOW_FACTOR = 1.22;

export type Row = ProtoSegment & {
  /** For the chosen fixture Runner. */
  predictedS: number;
  pbS: number | null;
  /** Predicted Time ÷ Target Record. */
  gapRatio: number;
  achievable: boolean;
  held: boolean;
  lowConfidence: boolean;
};

export type Results = {
  main: Row[];
  nearestMisses: Row[];
  suspicious: Row[];
  achievableCount: number;
  inAreaCount: number;
};

/** The Ranking rules decided on wayfinder #11, in memory. */
export function rank(runner: Runner, margin: Margin, radiusKm: SearchRadiusKm): Results {
  const factor = runner === 'slow' ? SLOW_FACTOR : 1;
  const rows: Row[] = SEGMENTS.filter((s) => s.kmFromCentre <= radiusKm).map((s) => {
    const predictedS = Math.round(s.predictedS * factor);
    const pbS = s.pbS === null ? null : Math.round(s.pbS * factor);
    return {
      ...s,
      predictedS,
      pbS,
      gapRatio: predictedS / s.targetRecordS,
      achievable: predictedS <= s.targetRecordS * (1 + margin / 100),
      held: pbS !== null && pbS <= s.targetRecordS,
      lowConfidence: s.lowConfidenceReason !== null,
    };
  });

  const byImpressiveness = (a: Row, b: Row) =>
    b.athleteCount - a.athleteCount || a.gapRatio - b.gapRatio || a.id - b.id;

  const main = rows
    .filter((r) => (r.achievable && !r.implausible) || r.held)
    .sort((a, b) => Number(a.lowConfidence) - Number(b.lowConfidence) || byImpressiveness(a, b));
  const achievableCount = rows.filter((r) => r.achievable && !r.implausible).length;
  const nearestMisses =
    achievableCount < 5
      ? rows
          .filter((r) => !r.achievable && !r.implausible && !r.held)
          .sort((a, b) => a.gapRatio - b.gapRatio || a.id - b.id)
          .slice(0, 10)
      : [];
  // Held + Implausible stays in the main list only (open question for the Runner).
  const suspicious = rows.filter((r) => r.implausible && !r.held).sort(byImpressiveness);

  return { main, nearestMisses, suspicious, achievableCount, inAreaCount: rows.length };
}

/** "3% to spare", "within 2%", "needs 4% faster". */
export function gapLabel(row: Row): string {
  const pct = Math.round(Math.abs(row.gapRatio - 1) * 100);
  if (row.gapRatio <= 1) return pct === 0 ? 'level with record' : `${pct}% faster than record`;
  return row.achievable ? `within ${pct}%` : `needs ${pct}% faster`;
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

export function formatGrade(g: number): string {
  return `${g > 0 ? '+' : ''}${g.toFixed(1)}%`;
}

export const PROTO_AREA_LABEL = 'Bristol city centre';
