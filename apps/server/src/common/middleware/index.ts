import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError, type ZodSchema } from "zod";
import { AppError, ValidationError } from "../errors/index.js";
import { logger } from "../../config/logger.js";

// ─── Global Error Handler ─────────────────────────────────────

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  // Zod validation errors → 400
  if (err instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const path = issue.path.join(".");
      if (!details[path]) details[path] = [];
      details[path].push(issue.message);
    }
    res.status(400).json({
      success: false,
      error: "Validation Error",
      message: "Request validation failed",
      statusCode: 400,
      details,
    });
    return;
  }

  // Known operational errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.name,
      message: err.message,
      statusCode: err.statusCode,
      ...((err as ValidationError).details ? { details: (err as ValidationError).details } : {}),
    });
    return;
  }

  // Unknown errors → 500
  logger.error("Unhandled error:", err);
  res.status(500).json({
    success: false,
    error: "Internal Server Error",
    message: "Something went wrong",
    statusCode: 500,
  });
}

// ─── 404 Not Found Handler ────────────────────────────────────

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: "Not Found",
    message: `Route not found: ${_req.method} ${_req.originalUrl}`,
    statusCode: 404,
  });
}

// ─── Validation Middleware ────────────────────────────────────

type ValidationTarget = "body" | "query" | "params";

/**
 * Middleware factory that validates the request against a Zod schema.
 * Supports validating body, query, or params.
 */
export function validate(schema: ZodSchema, source: ValidationTarget = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req[source]);
      // Replace with parsed (strips unknown keys, coerces types)
      if (source === "body") {
        req.body = parsed;
      } else if (source === "query") {
        // Express v5 makes req.query a getter-only property — redefine it
        Object.defineProperty(req, "query", {
          value: parsed,
          writable: true,
          configurable: true,
        });
      } else if (source === "params") {
        req.params = parsed;
      }
      next();
    } catch (err) {
      next(err); // Will be caught by errorHandler
    }
  };
}

// ─── Async Handler Wrapper ────────────────────────────────────

/**
 * Wraps an async route handler to catch rejected promises
 * and forward them to the Express error handler.
 * Generic type parameter allows handlers using AuthenticatedRequest.
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => void | Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}
