import type { FlatPoint } from './flat-model.js';
import { gradeAdjustedTime, type PredictSegment } from './predict.js';
import type { RecordGender } from './target-record.js';
import { IMPLAUSIBLE_FACTOR } from './tunables.js';

/**
 * Outdoor world records (seconds) at the standard distances, from World Athletics
 * (worldathletics.org/records/by-category/world-records), as of 2026-09. Men's are used for
 * KOMs, women's for QOMs. The half and marathon are road records.
 */
export const WORLD_RECORDS: Record<RecordGender, readonly FlatPoint[]> = {
  KOM: [
    { metres: 100, seconds: 9.58 }, // Usain Bolt, 2009
    { metres: 200, seconds: 19.19 }, // Usain Bolt, 2009
    { metres: 400, seconds: 43.03 }, // Wayde van Niekerk, 2016
    { metres: 800, seconds: 100.91 }, // David Rudisha, 2012 (1:40.91)
    { metres: 1500, seconds: 206.0 }, // Hicham El Guerrouj, 1998 (3:26.00)
    { metres: 1609.344, seconds: 223.13 }, // Hicham El Guerrouj, 1999 (3:43.13)
    { metres: 3000, seconds: 437.55 }, // Jakob Ingebrigtsen, 2024 (7:17.55)
    { metres: 5000, seconds: 755.36 }, // Joshua Cheptegei, 2020 (12:35.36)
    { metres: 10000, seconds: 1571.0 }, // Joshua Cheptegei, 2020 (26:11.00)
    { metres: 21097.5, seconds: 3402 }, // Jacob Kiplimo, 2025 (56:42)
    { metres: 42195, seconds: 7235 }, // Kelvin Kiptum, 2023 (2:00:35)
  ],
  QOM: [
    { metres: 100, seconds: 10.49 }, // Florence Griffith-Joyner, 1988
    { metres: 200, seconds: 21.34 }, // Florence Griffith-Joyner, 1988
    { metres: 400, seconds: 47.6 }, // Marita Koch, 1985
    { metres: 800, seconds: 113.28 }, // Jarmila Kratochvílová, 1983 (1:53.28)
    { metres: 1500, seconds: 229.04 }, // Faith Kipyegon, 2024 (3:49.04)
    { metres: 1609.344, seconds: 247.98 }, // Faith Kipyegon, 2023 (4:07.98)
    { metres: 3000, seconds: 486.11 }, // Wang Junxia, 1993 (8:06.11)
    { metres: 5000, seconds: 838.06 }, // Beatrice Chebet, 2025 (13:58.06)
    { metres: 10000, seconds: 1734.14 }, // Beatrice Chebet, 2024 (28:54.14)
    { metres: 21097.5, seconds: 3772 }, // Letesenbet Gidey, 2021 (1:02:52)
    { metres: 42195, seconds: 7796 }, // Ruth Chepngetich, 2024 (2:09:56)
  ],
};

/**
 * Implausible Record: the Target Record (seconds) is faster than the world-record table, run
 * through the Predicted Time model for this Segment, × IMPLAUSIBLE_FACTOR.
 */
export function isImplausible(
  record: number,
  segment: PredictSegment,
  gender: RecordGender,
): boolean {
  const worldRecord = gradeAdjustedTime(WORLD_RECORDS[gender], segment);
  return worldRecord !== null && record < worldRecord * IMPLAUSIBLE_FACTOR;
}
