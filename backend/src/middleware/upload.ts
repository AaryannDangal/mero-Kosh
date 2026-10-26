import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { ALLOWED_MIME, sniffMime, storage } from '../lib/storage';
import { badRequest } from '../lib/errors';

const memory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) return cb(badRequest('Only JPEG, PNG, WEBP images or PDF files are allowed'));
    cb(null, true);
  },
});

/** Accepts an optional single file in `field`, validates magic bytes and stores it. Sets req.body.__fileKey. */
export function singleUpload(field: string, folder: string) {
  const mw = memory.single(field);
  return (req: Request, res: Response, next: NextFunction) => {
    mw(req, res, async (err: unknown) => {
      try {
        if (err) {
          if (err instanceof multer.MulterError) throw badRequest(err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${config.maxUploadBytes / 1024 / 1024} MB)` : err.message);
          throw err;
        }
        if (req.file) {
          const sniffed = sniffMime(req.file.buffer);
          if (!sniffed || !ALLOWED_MIME.includes(sniffed)) throw badRequest('File content does not match an allowed type');
          const stored = await storage.save(req.file.buffer, req.file.originalname, sniffed, folder);
          (req as Request & { fileKey?: string }).fileKey = stored.key;
        }
        next();
      } catch (e) {
        next(e);
      }
    });
  };
}

export function fileKeyOf(req: Request): string | undefined {
  return (req as Request & { fileKey?: string }).fileKey;
}
