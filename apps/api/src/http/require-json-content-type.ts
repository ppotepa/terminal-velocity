import { HttpProblem } from './http-problem.ts';

export function requireJsonContentType(header: string | undefined): void {
  // This endpoint accepts JSON encoded as UTF-8; arbitrary media type parameters are not supported.
  if (header === undefined || !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(header)) {
    throw new HttpProblem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json with UTF-8 encoding.');
  }
}
