import type { CorsOptions } from "cors";
import { env } from "./env.js";

const allowedOrigins = env.CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * In development the Vite dev server may run on any port (5173, 5174, ...)
 * and may be reached via `localhost` or `127.0.0.1`. Matching the exact
 * origin breaks as soon as the port changes, so we accept any localhost
 * origin. Production stays strict and only allows configured origins.
 */
function isLocalDevOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const { protocol, hostname } = new URL(origin);
    return (
      (protocol === "http:" || protocol === "https:") &&
      (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
    );
  } catch {
    return false;
  }
}

function isVercelOrRenderOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname.endsWith(".vercel.app") || hostname.endsWith(".onrender.com");
  } catch {
    return false;
  }
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Requests without an Origin header (curl, server-to-server, same-origin) are allowed.
    if (!origin) return callback(null, true);

    // Wildcard '*' explicitly configured allows any origin.
    if (allowedOrigins.includes("*")) return callback(null, true);

    // Explicitly configured origins are always allowed.
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // Allow Vercel and Render preview/production deployments.
    if (isVercelOrRenderOrigin(origin)) return callback(null, true);

    // Any localhost origin is allowed during development (any port / IP).
    if (env.NODE_ENV !== "production" && isLocalDevOrigin(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 204,
};
