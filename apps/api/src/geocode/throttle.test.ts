import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThrottle } from './throttle.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createThrottle', () => {
  it('runs the first task straight away', async () => {
    const throttle = createThrottle(1000);
    const task = vi.fn(async () => 'done');
    const result = throttle(task);
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledOnce();
    await expect(result).resolves.toBe('done');
  });

  it('starts queued tasks at least the interval apart, in call order', async () => {
    const throttle = createThrottle(1000);
    const starts: [string, number][] = [];
    const task = (name: string) => async () => {
      starts.push([name, Date.now()]);
      return name;
    };
    const t0 = Date.now();
    const results = Promise.all([throttle(task('a')), throttle(task('b')), throttle(task('c'))]);

    await vi.advanceTimersByTimeAsync(999);
    expect(starts.map(([name]) => name)).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts.map(([name]) => name)).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(results).resolves.toEqual(['a', 'b', 'c']);
    expect(starts).toEqual([
      ['a', t0],
      ['b', t0 + 1000],
      ['c', t0 + 2000],
    ]);
  });

  it("doesn't wait once the interval has already passed", async () => {
    const throttle = createThrottle(1000);
    await throttle(async () => {});
    await vi.advanceTimersByTimeAsync(5000);
    const task = vi.fn(async () => {});
    void throttle(task);
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledOnce();
  });

  it('waits for a slow task to finish before starting the next', async () => {
    const throttle = createThrottle(1000);
    let finishSlow!: () => void;
    void throttle(() => new Promise<void>((resolve) => (finishSlow = resolve)));
    const next = vi.fn(async () => {});
    void throttle(next);
    await vi.advanceTimersByTimeAsync(3000);
    expect(next).not.toHaveBeenCalled();
    finishSlow();
    await vi.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalledOnce();
  });

  it('keeps going after a task fails', async () => {
    const throttle = createThrottle(1000);
    const failed = throttle(async () => {
      throw new Error('boom');
    });
    const next = throttle(async () => 'next');
    await expect(failed).rejects.toThrow('boom');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(next).resolves.toBe('next');
  });
});
