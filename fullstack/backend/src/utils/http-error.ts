export class HttpError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function assertOrThrow(condition: unknown, statusCode: number, code: string, message: string): asserts condition {
  if (!condition) {
    throw new HttpError(statusCode, code, message);
  }
}
