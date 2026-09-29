import { describe, expect, it } from 'vitest';
import { isHeld, parseXoms, recordFor, type RecordSource } from './target-record.js';

describe('parseXoms', () => {
  it.each([
    ['17s', 17],
    ['5s', 5],
    ['59s', 59],
    ['1:24', 84],
    ['0:59', 59],
    ['12:05', 725],
    ['75:00', 4500],
    ['1:02:03', 3723],
    ['2:21:03', 8463],
    ['10:00:00', 36000],
    [' 1:24 ', 84],
  ])('parses %j as %i seconds', (raw, seconds) => {
    expect(parseXoms(raw)).toEqual({ status: 'ok', seconds });
  });

  it.each([
    '',
    '   ',
    '17',
    '17 s',
    '17sec',
    's',
    '0s',
    '0:00',
    '1:5',
    '1:60',
    '1:024',
    '1:2:03',
    '1:60:00',
    '1:02:03:04',
    ':24',
    '1:24.5',
    '-1:24',
    '1,024',
    'n/a',
    '—',
    'KOM 1:24',
  ])('treats %j as unparseable', (raw) => {
    expect(parseXoms(raw)).toEqual({ status: 'unparseable' });
  });
});

describe('recordFor', () => {
  const segment = (overrides: Partial<RecordSource> = {}): RecordSource => ({
    hazardous: false,
    xoms: { kom: '1:24', qom: '1:41' },
    ...overrides,
  });

  it('takes the KOM for KOM and the QOM for QOM', () => {
    expect(recordFor(segment(), 'KOM')).toEqual({ status: 'ok', seconds: 84 });
    expect(recordFor(segment(), 'QOM')).toEqual({ status: 'ok', seconds: 101 });
  });

  it('is hazardous when the leaderboard is hidden, whatever xoms says', () => {
    expect(recordFor(segment({ hazardous: true }), 'KOM')).toEqual({ status: 'hazardous' });
    expect(recordFor(segment({ hazardous: true, xoms: null }), 'QOM')).toEqual({
      status: 'hazardous',
    });
  });

  it('is missing when there is no record for that gender', () => {
    const komOnly = segment({ xoms: { kom: '17s' } });
    expect(recordFor(komOnly, 'KOM')).toEqual({ status: 'ok', seconds: 17 });
    expect(recordFor(komOnly, 'QOM')).toEqual({ status: 'missing' });
    expect(recordFor(segment({ xoms: { kom: '17s', qom: null } }), 'QOM')).toEqual({
      status: 'missing',
    });
    expect(recordFor(segment({ xoms: { kom: '17s', qom: '' } }), 'QOM')).toEqual({
      status: 'missing',
    });
  });

  it('is missing when there is no xoms at all', () => {
    expect(recordFor(segment({ xoms: null }), 'KOM')).toEqual({ status: 'missing' });
    expect(recordFor(segment({ xoms: {} }), 'QOM')).toEqual({ status: 'missing' });
  });

  it('is unparseable for a garbage string, for that gender only', () => {
    const garbled = segment({ xoms: { kom: '1:24', qom: 'about 2 min' } });
    expect(recordFor(garbled, 'QOM')).toEqual({ status: 'unparseable' });
    expect(recordFor(garbled, 'KOM')).toEqual({ status: 'ok', seconds: 84 });
  });

  it('parses h:mm:ss records', () => {
    expect(recordFor(segment({ xoms: { kom: '1:02:03' } }), 'KOM')).toEqual({
      status: 'ok',
      seconds: 3723,
    });
  });
});

describe('isHeld', () => {
  it('is Held when the Segment PB beats the record', () => {
    expect(isHeld(83, 84)).toBe(true);
  });

  it('counts a tie as Held', () => {
    expect(isHeld(84, 84)).toBe(true);
  });

  it('compares in whole seconds', () => {
    expect(isHeld(84.4, 84)).toBe(true);
    expect(isHeld(84.6, 84)).toBe(false);
  });

  it('is not Held when the Segment PB is slower', () => {
    expect(isHeld(85, 84)).toBe(false);
  });

  it('is not Held without a Segment PB', () => {
    expect(isHeld(null, 84)).toBe(false);
    expect(isHeld(undefined, 84)).toBe(false);
  });
});
