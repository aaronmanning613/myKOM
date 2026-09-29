export type Throttle = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Runs tasks one at a time, in call order, starting each at least `intervalMs` after the
 * previous one started (and never before it finished).
 */
export function createThrottle(intervalMs: number): Throttle {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = -Infinity;
  return (task) => {
    const run = tail.then(async () => {
      const wait = lastStart + intervalMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastStart = Date.now();
      return task();
    });
    // A failed task mustn't stop the ones queued behind it.
    tail = run.catch(() => {});
    return run;
  };
}
