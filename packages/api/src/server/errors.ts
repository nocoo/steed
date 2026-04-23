export class WorkerApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "WorkerApiError";
    this.status = status;
    this.body = body;
  }
}

export class ApiHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.body = body;
  }
}
