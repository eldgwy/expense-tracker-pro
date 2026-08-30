import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const currentDir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : resolve(fileURLToPath(import.meta.url), "..");

config({ path: resolve(currentDir, "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
