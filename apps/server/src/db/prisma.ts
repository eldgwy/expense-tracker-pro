import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

interface GlobalPrismaState {
  prisma?: PrismaClient;
  pool?: pg.Pool;
}

const globalForPrisma = globalThis as typeof globalThis & GlobalPrismaState;

function createPool(): pg.Pool {
  const isProd = env.NODE_ENV === "production";
  const isLocalhost =
    env.DATABASE_URL.includes("localhost") || env.DATABASE_URL.includes("127.0.0.1");

  const needsSsl =
    !isLocalhost &&
    (env.DATABASE_URL.includes("sslmode=require") ||
      env.DATABASE_URL.includes("sslmode=no-verify") ||
      env.DATABASE_URL.includes("neon.tech") ||
      env.DATABASE_URL.includes("supabase.co") ||
      env.DATABASE_URL.includes("pooler.supabase.com") ||
      isProd);

  return new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: isProd ? 2 : 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

const pool = globalForPrisma.pool ?? createPool();
if (!globalForPrisma.pool) {
  globalForPrisma.pool = pool;
}

const adapter = new PrismaPg(pool);

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}

export default prisma;
