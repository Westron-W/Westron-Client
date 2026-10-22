export class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function sendError(reply, statusCode, code, message) {
  return reply.code(statusCode).send({ error: { code, message } });
}
