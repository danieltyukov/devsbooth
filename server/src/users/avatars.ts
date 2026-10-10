import { randomBytes } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { HttpError } from '../http/errors';
import { log } from '../log';

const SIZE = 256;

/** Crops and resizes an uploaded image to a square WebP and returns its file name. */
export async function saveAvatar(dir: string, userId: string, image: Buffer): Promise<string> {
  await mkdir(dir, { recursive: true });
  const name = `${userId}-${randomBytes(6).toString('hex')}.webp`;
  try {
    await sharp(image, { animated: false, limitInputPixels: 50_000_000 })
      .rotate()
      .resize(SIZE, SIZE, { fit: 'cover' })
      .webp({ quality: 82 })
      .toFile(path.join(dir, name));
  } catch {
    throw new HttpError(400, 'bad_request', 'That file is not an image we can read. Try a PNG, JPEG or WebP.');
  }
  return name;
}

export async function deleteAvatar(dir: string, name: string | undefined): Promise<void> {
  if (!name || name.includes('/') || name.includes('\\')) return;
  try {
    await unlink(path.join(dir, name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('Could not delete avatar', { name, err });
  }
}
