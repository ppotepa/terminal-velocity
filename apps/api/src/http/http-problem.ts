/** A deliberately public transport error. Never construct this with a raw exception message. */
export class HttpProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Readonly<Record<string, string>>;

  constructor(status: number, code: string, message: string, headers: Readonly<Record<string, string>> = {}) {
    super(message);
    this.name = 'HttpProblem';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}
