import type { Mutex } from '../ports/mutex.ts';
export function createAsyncMutex(): Mutex {
  let tail: Promise<void> = Promise.resolve();
  return { async run<T>(work: () => Promise<T> | T): Promise<T> {
    const previous = tail;
    let release: () => void = () => {};
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  } };
}
