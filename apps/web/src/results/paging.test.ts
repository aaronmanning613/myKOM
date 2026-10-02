import { describe, expect, it } from 'vitest';
import { INITIAL_SHOWN, nextShown, RESULTS_PAGE_SIZE, showMoreLabel, visibleRows } from './paging';

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('paging', () => {
  it('starts every list at one page', () => {
    expect(RESULTS_PAGE_SIZE).toBe(20);
    expect(INITIAL_SHOWN).toEqual({ targets: 20, nearestMisses: 20, suspicious: 20 });
  });

  it('shows every row and no button under a page', () => {
    expect(visibleRows(rows(7), 20)).toEqual(rows(7));
    expect(showMoreLabel(7, 20)).toBeNull();
  });

  it('shows every row and no button at exactly a page', () => {
    expect(visibleRows(rows(20), 20)).toEqual(rows(20));
    expect(showMoreLabel(20, 20)).toBeNull();
  });

  it('shows the first page of a longer list, in order, with a full next page', () => {
    expect(visibleRows(rows(47), 20)).toEqual(rows(20));
    expect(showMoreLabel(47, 20)).toEqual({
      status: 'Showing 20 of 47',
      button: 'Show 20 more',
    });
    expect(nextShown(47, 20)).toBe(40);
  });

  it('offers only what remains on the last partial page, then nothing', () => {
    expect(showMoreLabel(47, 40)).toEqual({ status: 'Showing 40 of 47', button: 'Show 7 more' });
    expect(nextShown(47, 40)).toBe(47);
    expect(visibleRows(rows(47), 47)).toEqual(rows(47));
    expect(showMoreLabel(47, 47)).toBeNull();
  });

  it('shows every row of a list that shrank below the shown count', () => {
    expect(visibleRows(rows(12), 40)).toEqual(rows(12));
    expect(showMoreLabel(12, 40)).toBeNull();
    expect(nextShown(12, 40)).toBe(12);
  });
});
