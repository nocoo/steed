import type { Context } from "hono";

/**
 * Standard error response format
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Send a JSON success response
 */
export function jsonResponse<T>(c: Context, data: T, status = 200) {
  return c.json(data, status);
}

/**
 * Send a JSON error response
 */
export function errorResponse(
  c: Context,
  code: string,
  message: string,
  status: number
) {
  const body: ErrorResponse = {
    error: { code, message },
  };
  return c.json(body, status);
}

/**
 * Common error responses
 */
export const errors = {
  invalidRequest: (c: Context, message = "Invalid request body") =>
    errorResponse(c, "invalid_request", message, 400),

  unauthorized: (c: Context, message = "Missing or invalid API key") =>
    errorResponse(c, "unauthorized", message, 401),

  forbidden: (c: Context, message = "Permission denied") =>
    errorResponse(c, "forbidden", message, 403),

  notFound: (c: Context, resource = "Resource") =>
    errorResponse(c, "not_found", `${resource} not found`, 404),

  conflict: (c: Context, message = "Resource already exists") =>
    errorResponse(c, "conflict", message, 409),

  internalError: (c: Context, message = "Internal server error") =>
    errorResponse(c, "internal_error", message, 500),
};
