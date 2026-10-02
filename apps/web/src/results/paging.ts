// Client-side paging of the results lists: each list shows its first RESULTS_PAGE_SIZE rows, in
// the order the API ranked them, and "Show more" reveals the next page. The API still returns
// every row.

/** How many rows a list shows at first, and how many more each "Show more" reveals. */
export const RESULTS_PAGE_SIZE = 20;

/** How many rows each results list shows. */
export type ShownCounts = { targets: number; nearestMisses: number; suspicious: number };

export const INITIAL_SHOWN: ShownCounts = {
  targets: RESULTS_PAGE_SIZE,
  nearestMisses: RESULTS_PAGE_SIZE,
  suspicious: RESULTS_PAGE_SIZE,
};

/** The rows a list shows: all of them when the list has shrunk below `shown`. */
export const visibleRows = <T>(rows: readonly T[], shown: number): T[] => rows.slice(0, shown);

/** The shown count after "Show more": up to a page more, capped at the total. */
export const nextShown = (total: number, shown: number): number =>
  Math.min(total, shown + RESULTS_PAGE_SIZE);

/** The "Showing 20 of 47" line and "Show 20 more" button, or null when every row shows. */
export function showMoreLabel(
  total: number,
  shown: number,
): { status: string; button: string } | null {
  if (shown >= total) return null;
  return {
    status: `Showing ${shown} of ${total}`,
    button: `Show ${nextShown(total, shown) - shown} more`,
  };
}
