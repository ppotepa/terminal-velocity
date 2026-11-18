import { Buffer } from 'node:buffer';
import type { IncomingMessage } from 'node:http';
import { TextDecoder } from 'node:util';
import { HttpProblem } from './http-problem.ts';
import { requireJsonContentType } from './require-json-content-type.ts';

export const MAX_JSON_BODY_BYTES = 16 * 1024;

/** Reads bytes with a bounded buffer. The backend, not this adapter, validates the JSON model. */
export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  requireJsonContentType(request.headers['content-type']);
  const declared = request.headers['content-length'];
  if (declared !== undefined && Number(declared) > MAX_JSON_BODY_BYTES) throw bodyTooLarge();

  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const fail = (error: HttpProblem) => { cleanup(); request.resume(); reject(error); };
    const onData = (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > MAX_JSON_BODY_BYTES) { fail(bodyTooLarge()); return; }
      chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks, total)); };
    const onError = () => fail(new HttpProblem(400, 'INVALID_BODY', 'The request body could not be read.'));
    const onAborted = () => fail(new HttpProblem(400, 'INVALID_BODY', 'The request body was interrupted.'));
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new HttpProblem(400, 'INVALID_JSON', 'The request body must be valid UTF-8 JSON.');
  }
}

function bodyTooLarge(): HttpProblem {
  return new HttpProblem(413, 'PAYLOAD_TOO_LARGE', `The request body must not exceed ${MAX_JSON_BODY_BYTES} bytes.`,
    { Connection: 'close' });
}
