/** Retain only the HTTP(S) origin and the caller's public-safe page path. */
export function sourcePageLocation(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  try {
    const url = new URL(input);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || !/^[a-zA-Z0-9.-]+$/u.test(url.hostname)) return null;
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}
