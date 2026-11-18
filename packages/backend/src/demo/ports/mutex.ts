export interface Mutex { run<T>(work: () => Promise<T> | T): Promise<T>; }
