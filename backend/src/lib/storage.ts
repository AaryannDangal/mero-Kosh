/**
 * File storage abstraction. MVP stores files on local disk outside the public
 * web root; files are only streamed through authenticated endpoints.
 * To move to S3/Cloudinary implement the same interface and switch `storage`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';

export interface StoredFile {
  key: string;
  size: number;
  mimeType: string;
}

export interface FileStorage {
  save(buffer: Buffer, originalName: string, mimeType: string, folder: string): Promise<StoredFile>;
  open(key: string): fs.ReadStream;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

export const ALLOWED_MIME = Object.keys(EXT_BY_MIME);

/** Verify magic bytes so a renamed executable can't masquerade as an image. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

class LocalStorage implements FileStorage {
  constructor(private root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async save(buffer: Buffer, _originalName: string, mimeType: string, folder: string): Promise<StoredFile> {
    const ext = EXT_BY_MIME[mimeType] ?? '.bin';
    const safeFolder = folder.replace(/[^a-zA-Z0-9_-]/g, '');
    const key = `${safeFolder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}${ext}`;
    const full = this.resolve(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, buffer, { mode: 0o600 });
    return { key, size: buffer.length, mimeType };
  }

  open(key: string): fs.ReadStream {
    return fs.createReadStream(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fsp.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await fsp.unlink(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export const storage: FileStorage = new LocalStorage(config.uploadDir);

export function mimeForKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  return Object.entries(EXT_BY_MIME).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
}
