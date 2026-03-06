// src/feishu/image.ts
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const IMAGE_DIR = '/tmp/feishu-images';

export function saveImage(imageBuffer: Buffer, extension: string = 'png'): string {
  mkdirSync(IMAGE_DIR, { recursive: true });
  const filename = `${randomUUID()}.${extension}`;
  const filepath = join(IMAGE_DIR, filename);
  writeFileSync(filepath, imageBuffer);
  return filepath;
}
