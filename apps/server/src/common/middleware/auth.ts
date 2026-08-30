import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../errors/index.js";
import type { AuthenticatedRequest, JwtPayload } from "../types/index.js";

/**
 * Middleware that verifies the JWT access token from the Authorization header.
 * Attaches the decoded user payload to `req.user`.
 * Returns 401 if the token is missing, expired, or invalid.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return next(new UnauthorizedError("No authorization token provided"));
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return next(new UnauthorizedError("Invalid authorization format. Use: Bearer <token>"));
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    (req as AuthenticatedRequest).user = {
      id: decoded.sub,
      email: decoded.email,
    };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(new UnauthorizedError("Access token has expired"));
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return next(new UnauthorizedError("Invalid access token"));
    }
    return next(new UnauthorizedError("Authentication failed"));
  }
}
