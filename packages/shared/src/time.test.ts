import { describe, expect, it } from 'vitest';
import { formatPace, formatTime, pacePerKm, parseTime } from './time.js';

describe('parseTime', () => {
  it.each([
    ['45', 45],
    ['75', 75],
    ['3:42', 222],
    ['0:59', 59],
    ['16:30', 990],
    ['65:00', 3900],
    ['1:05:10', 3910],
    ['10:00:00', 36000],
  ])('parses %j as %i seconds', (input, seconds) => {
    expect(parseTime(input)).toEqual({ ok: true, seconds });
  });

  it.each([
    ['007', 7],
    ['03:42', 222],
    ['0:03:42', 222],
    ['01:05:10', 3910],
  ])('accepts leading zeros: %j', (input, seconds) => {
    expect(parseTime(input)).toEqual({ ok: true, seconds });
  });

  it('ignores surrounding whitespace', () => {
    expect(parseTime('  3:42 ')).toEqual({ ok: true, seconds: 222 });
  });

  it.each(['', '   '])('rejects an empty string %j', (input) => {
    expect(parseTime(input)).toEqual({ ok: false, error: 'Enter a time' });
  });

  it.each(['3:60', '3:75', '1:60:00', '1:05:60'])(
    'rejects minutes or seconds of 60 or more after a colon: %j',
    (input) => {
      expect(parseTime(input)).toEqual({
        ok: false,
        error: 'Minutes and seconds must be under 60',
      });
    },
  );

  it.each([
    '3:5',
    '3:505',
    '1:5:10',
    ':42',
    '3:',
    '1:02:03:04',
    '3.42',
    '3:42.5',
    '-3:42',
    '+75',
    '3 42',
    'abc',
    '1e3',
    '３:42',
  ])('rejects badly formed input %j', (input) => {
    expect(parseTime(input)).toEqual({ ok: false, error: 'Enter a time like 75, 3:42 or 1:05:10' });
  });

  it.each(['0', '00', '0:00', '0:00:00'])('rejects a zero time %j', (input) => {
    expect(parseTime(input)).toEqual({ ok: false, error: 'Time must be more than zero' });
  });
});

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [7, '0:07'],
    [59, '0:59'],
    [60, '1:00'],
    [222, '3:42'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3910, '1:05:10'],
    [36000, '10:00:00'],
  ])('formats %i as %j', (seconds, text) => {
    expect(formatTime(seconds)).toBe(text);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %d', (seconds) => {
    expect(() => formatTime(seconds)).toThrow(RangeError);
  });

  it('round-trips with parseTime', () => {
    for (const seconds of [1, 59, 60, 222, 3599, 3600, 3910, 86399]) {
      expect(parseTime(formatTime(seconds))).toEqual({ ok: true, seconds });
    }
  });
});

describe('pacePerKm', () => {
  it('divides the time by the distance in kilometres', () => {
    expect(pacePerKm(1200, 5000)).toBe(240);
    expect(pacePerKm(75, 400)).toBe(187.5);
  });

  it.each([
    [0, 1000],
    [60, 0],
    [-60, 1000],
  ])('rejects time %i over %i metres', (seconds, metres) => {
    expect(() => pacePerKm(seconds, metres)).toThrow(RangeError);
  });
});

describe('formatPace', () => {
  it('formats seconds per km to the nearest second', () => {
    expect(formatPace(240)).toBe('4:00/km');
    expect(formatPace(187.5)).toBe('3:08/km');
    expect(formatPace(266.4)).toBe('4:26/km');
  });

  it('formats a mile time as pace per km', () => {
    // A 6:00 mile is 3:44 per km.
    expect(formatPace(pacePerKm(360, 1609.344))).toBe('3:44/km');
  });
});
