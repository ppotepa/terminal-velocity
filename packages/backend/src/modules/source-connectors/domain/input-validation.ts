export type PlainRecord = Record<string, unknown>;

/** Copies own data properties only; callers never evaluate accessors on untrusted input. */
export function plainRecord(input: unknown): PlainRecord | null {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const output: PlainRecord = Object.create(null) as PlainRecord;
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string') return null;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !('value' in descriptor)) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return null;
  }
}

export function hasOnlyKeys(record: PlainRecord, allowed: readonly string[]): boolean {
  const keySet = new Set(allowed);
  return Object.keys(record).every(key => keySet.has(key));
}

export function hasOwn(record: PlainRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function isOpaqueText(input: unknown, maxLength: number): input is string {
  return typeof input === 'string'
    && input.length > 0
    && input.length <= maxLength
    && input === input.trim()
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(input);
}

export function isToken(input: unknown, maxLength = 128): input is string {
  return typeof input === 'string'
    && input.length > 0
    && input.length <= maxLength
    && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(input);
}

/** Read a bounded, dense array of data properties without using its element getters or iterator. */
export function plainList(input: unknown, maximum: number): unknown[] | null {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return null;
    const length: unknown = Object.getOwnPropertyDescriptor(input, 'length')?.value;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > maximum)
      return null;
    if (Reflect.ownKeys(input).length !== length + 1) return null;
    const values: unknown[] = [];
    for (let i = 0; i < length; i++) {
      const element = Object.getOwnPropertyDescriptor(input, i);
      if (!element || !('value' in element)) return null;
      values.push(element.value);
    }
    return values;
  } catch {
    return null;
  }
}

export function uniqueTokenList(input: unknown, maximum: number): readonly string[] | null {
  const items = plainList(input, maximum);
  if (!items) return null;
  const tokens = new Set<string>();
  for (const item of items) {
    if (!isToken(item) || tokens.has(item)) return null;
    tokens.add(item);
  }
  return Object.freeze([...tokens]);
}
