import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { RequestHandler, NextFunction } from "express";
import { ValidationError } from "../errors/index.js";
import { logger } from "../../config/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateId(): string {
  return crypto.randomUUID();
}

// Uploads directory: server/uploads/
export const UPLOADS_DIR = path.resolve(__dirname, "../../../uploads");
export const AVATARS_DIR = path.join(UPLOADS_DIR, "avatars");
export const RECEIPTS_DIR = path.join(UPLOADS_DIR, "receipts");

// Ensure the upload directories exist at module load.
// Best-effort: on serverless hosts (e.g. Vercel) the filesystem is read-only,
// so failures are ignored — the API must still boot, and upload endpoints
// surface their own errors at request time.
try {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
} catch {
  // Read-only filesystem (e.g. Vercel serverless) — uploads unavailable here.
  // Warn so a misconfigured writable host (permissions) isn't silently masked.
  logger.warn(
    "[upload] Could not create upload directories — uploads will be unavailable " +
      "(read-only filesystem or insufficient permissions)",
  );
}

// ─── Allowed MIME types ───────────────────────────────────────

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

// Server-side extension derived from the (validated) MIME type — never from
// the client-supplied filename, which could smuggle an .html/.svg payload.
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

// ─── Magic-byte signatures ─────────────────────────────────────
// The declared MIME type is client-controlled, so we additionally verify the
// actual file content before accepting it. Prevents HTML/SVG disguised as
// images (stored XSS via the static /uploads serving).

function detectImageType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("latin1") === "GIF8") {
    return "image/gif";
  }
  return null;
}

/**
 * Verifies that the uploaded file on disk is a real image matching its
 * declared MIME type. Deletes the file and rejects the request otherwise.
 */
async function verifyUploadedImage(
  req: Express.Request,
  _res: Express.Response,
  next: NextFunction,
): Promise<void> {
  const file = (req as Express.Request & { file?: Express.Multer.File }).file;
  if (!file) return next();

  try {
    const buffer = await fsp.readFile(file.path);
    const detected = detectImageType(buffer);

    if (detected !== file.mimetype) {
      await fsp.unlink(file.path).catch(() => {});
      next(
        new ValidationError(
          "Uploaded file is not a valid image of the declared type. Only JPEG, PNG, WebP, and GIF are allowed.",
        ),
      );
      return;
    }
    next();
  } catch {
    await fsp.unlink(file.path).catch(() => {});
    next(new ValidationError("Could not verify the uploaded image."));
  }
}

// ─── Storage Configuration ────────────────────────────────────

function makeDiskStorage(dir: string) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      // Extension derived from the validated MIME type, never originalname.
      const ext = MIME_TO_EXT[file.mimetype] ?? "";
      cb(null, `${generateId()}${ext}`);
    },
  });
}

// ─── File Filter ──────────────────────────────────────────────

function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_MIME_TYPES)[number])) {
    cb(null, true);
  } else {
    cb(new ValidationError("Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed."));
  }
}

// ─── Exported Upload Middleware ────────────────────────────────

const avatarMulter = multer({
  storage: makeDiskStorage(AVATARS_DIR),
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
}).single("avatar");

/** Uploads an avatar, then verifies the file content is a real image. */
export const uploadAvatarMiddleware: RequestHandler = (req, res, next) => {
  avatarMulter(req, res, (err) => {
    if (err) return next(err);
    verifyUploadedImage(req, res, next).catch(next);
  });
};

/**
 * Returns the public URL path for an avatar filename.
 */
export function getAvatarUrl(filename: string): string {
  return `/uploads/avatars/${filename}`;
}

/**
 * Deletes an avatar file from disk by its filename.
 */
export async function deleteAvatarFile(filename: string): Promise<void> {
  const filePath = path.join(AVATARS_DIR, filename);
  try {
    await fsp.unlink(filePath);
  } catch {
    // File may not exist — ignore
  }
}

// ─── Receipt Upload ───────────────────────────────────────────

const receiptMulter = multer({
  storage: makeDiskStorage(RECEIPTS_DIR),
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
}).single("receipt");

/** Uploads a receipt image, then verifies the file content is a real image. */
export const uploadReceiptMiddleware: RequestHandler = (req, res, next) => {
  receiptMulter(req, res, (err) => {
    if (err) return next(err);
    verifyUploadedImage(req, res, next).catch(next);
  });
};

/**
 * Returns the public URL path for a receipt filename.
 */
export function getReceiptUrl(filename: string): string {
  return `/uploads/receipts/${filename}`;
}

/**
 * Deletes a receipt file from disk by its URL path.
 * Accepts the full receiptUrl or just the filename.
 */
export async function deleteReceiptFile(receiptUrl: string): Promise<void> {
  const filename = receiptUrl.split("/").pop();
  if (!filename) return;
  const filePath = path.join(RECEIPTS_DIR, filename);
  try {
    await fsp.unlink(filePath);
  } catch {
    // File may not exist — ignore
  }
}
